// `orca init` — write a per-repo config so the few things zero-config can't safely
// guess get pinned once. init is the one command that *writes* state: the loader
// (config.ts) validates and resolves, `doctor` reads the machine, `init` writes a
// file. This first slice is just the detection layer — the questions init needs
// answered about a repo, each a small read over the `promisify(execFile)` idiom from
// engine/src/pr/github.ts. Assembly, writing, and the doctor gate come next.
import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs, promisify } from "node:util";
import { checkClaude } from "@orchestra/messenger";
import { CliError } from "../cli-error.js";
import { findConfig, type OrcaConfigInput, validateConfig } from "../config.js";

const exec = promisify(execFile);

/**
 * Resolve the git repository that contains `cwd`, as an absolute path. This is both
 * the target init acts on and where the config file lands. A non-git directory is a
 * user mistake, not a bug, so it surfaces as a one-line CliError (exit 1) rather than
 * a raw git stderr dump.
 */
export async function gitRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim();
  } catch {
    throw new CliError(`not a git repository: ${cwd}\nRun "git init" first, or pass --repo.`);
  }
}

/**
 * Best-guess the default base branch for PRs, in descending order of authority:
 *   1. the remote's default branch (origin/HEAD), when the remote advertises one
 *   2. the branch currently checked out (works on a fresh repo with no commits yet)
 *   3. the first conventional branch that exists locally — main, then master, then dev
 *   4. "main" as the universal fallback
 * The result is a suggestion the caller can override with --base; it never fails.
 */
export async function detectBase(repo: string): Promise<string> {
  // 1. The remote's default branch, e.g. refs/remotes/origin/main → "main".
  try {
    const { stdout } = await exec("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
      cwd: repo,
    });
    const name = stdout.trim().replace(/^refs\/remotes\/origin\//, "");
    if (name) return name;
  } catch {
    // origin/HEAD not set (no remote, or never fetched) — fall through.
  }

  // 2. The checkout's own branch. `symbolic-ref --short HEAD` resolves even when the
  // branch is unborn (git init -b main with no commit), which is exactly the init case.
  try {
    const { stdout } = await exec("git", ["symbolic-ref", "--short", "HEAD"], { cwd: repo });
    const name = stdout.trim();
    if (name) return name;
  } catch {
    // Detached HEAD — fall through to the conventional-name scan.
  }

  // 3. First conventional branch that actually exists as a local ref.
  for (const name of ["main", "master", "dev"]) {
    try {
      await exec("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], { cwd: repo });
      return name;
    } catch {
      // Not present — try the next.
    }
  }

  // 4. Nothing resolved; assume the modern default.
  return "main";
}

/** Whether init should offer a GitHub PR sink, and (only if non-default) which remote. */
export interface GithubDetection {
  /** `gh` is authenticated AND the repo has a git remote to push to. */
  available: boolean;
  /** The remote to push to, included only when it isn't the conventional "origin". */
  remote?: string;
}

/** The git remotes configured in `repo`, in git's listing order. */
async function remotes(repo: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git", ["remote"], { cwd: repo });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Whether the `gh` CLI is installed and logged in for this repo. */
async function ghAuthed(repo: string): Promise<boolean> {
  try {
    await exec("gh", ["auth", "status"], { cwd: repo });
    return true;
  } catch {
    // gh missing, or not logged in — either way GitHub PRs aren't available.
    return false;
  }
}

/**
 * Decide whether to offer `pr: { kind: "github" }`. It takes both an authenticated
 * `gh` and a remote to push to; without either, init keeps the local sink. The remote
 * is reported only when it isn't "origin" (the engine's own default), so a plain
 * origin setup never persists a redundant `remote` field.
 */
export async function detectGithub(repo: string): Promise<GithubDetection> {
  const configured = await remotes(repo);
  const [first] = configured;
  if (!first) return { available: false };
  if (!(await ghAuthed(repo))) return { available: false };
  return configured.includes("origin") ? { available: true } : { available: true, remote: first };
}

/** A package manager init can recognise from a lockfile. */
export type PackageManager = "pnpm" | "npm" | "yarn";

// Lockfile → manager, in preference order. pnpm first since that's this monorepo's.
const LOCKFILES: readonly { file: string; pm: PackageManager }[] = [
  { file: "pnpm-lock.yaml", pm: "pnpm" },
  { file: "yarn.lock", pm: "yarn" },
  { file: "package-lock.json", pm: "npm" },
];

/**
 * Sniff the repo's package manager from its lockfile. Purely informational — there is
 * no config field for it, so init only prints it in the next-steps hint and never
 * persists it. Returns undefined when no recognised lockfile is present.
 */
export async function detectPackageManager(repo: string): Promise<PackageManager | undefined> {
  for (const { file, pm } of LOCKFILES) {
    try {
      await access(path.join(repo, file));
      return pm;
    } catch {
      // Absent — try the next.
    }
  }
  return undefined;
}

// ── Config assembly ───────────────────────────────────────────
// Turn what init learned about a repo into the exact object it will write. The
// discipline here is "pin the choices, inherit the rest": a value equal to a schema
// default is never persisted, so the file stays minimal and zero-config keeps
// meaning what it says. The assembled object is then run back through the loader's
// own `validateConfig`, so there is one config definition, not two — init can never
// produce a file `loadConfig` would later reject.

/** The resolved detections and the flags that override them. */
export interface AssembleInput {
  /** What detection found: a base branch (always resolved) and the GitHub verdict. */
  detected: { base: string; github: GithubDetection };
  /** CLI flags that override detection, if given. */
  flags: {
    base?: string | undefined; // --base <ref>
    github?: boolean | undefined; // --github (undefined = not passed, so accept detection)
    remote?: string | undefined; // --remote <name>
  };
}

/**
 * Build the minimal `.orca.json` body from detections and flags, keeping only
 * non-default fields:
 *
 *   • base — the schema has no default for it, so a resolved base is always pinned
 *     (flag over detection).
 *   • pr   — "local" is the schema default and is omitted; only a GitHub sink is
 *     written. An explicit --github wins; otherwise init accepts the detected verdict.
 *     The remote is included only when it isn't "origin" (the engine's own default).
 *
 * Everything else (backend, limits, worktreeDir, …) is left to its default and never
 * appears in the file. The result is validated before return as a self-check.
 */
export function assembleConfig({ detected, flags }: AssembleInput): OrcaConfigInput {
  const input: OrcaConfigInput = {};

  // base has no schema default, so a value here is never redundant — always pin it.
  input.base = flags.base ?? detected.base;

  // Explicit --github wins; absent, accept what detection found. "local" is the
  // default, so we only ever write a GitHub sink.
  const useGithub = flags.github ?? detected.github.available;
  if (useGithub) {
    const remote = flags.remote ?? detected.github.remote;
    input.pr = remote && remote !== "origin" ? { kind: "github", remote } : { kind: "github" };
  }

  // Self-check: the object we're about to hand off to be written must satisfy the
  // same schema the loader enforces. A failure here is a bug in assembly, surfaced as
  // the house CliError rather than a silently-bad config file.
  validateConfig(input);
  return input;
}

// ── Writing to disk ───────────────────────────────────────────
// init is the one command that writes. It drops a generated `.orca.json` at the git
// root and makes sure the repo ignores Orca's scratch directory. Both steps are
// safe to re-run except the overwrite itself, which is gated behind --force.

const CONFIG_FILENAME = ".orca.json"; // generated configs are JSON; hand-authors use orca.config.ts
const IGNORE_ENTRY = ".orca/"; // Orca's per-repo scratch dir (traces, worktrees, local PRs)

/**
 * Append `.orca/` to the repo's `.gitignore`, idempotently. Creates the file if it
 * doesn't exist, and never duplicates the entry (it treats a bare `.orca` line as
 * already covering it). Preserves whatever is already there, keeping the file's
 * trailing-newline shape sane so the append doesn't glue onto a half-line.
 */
async function ensureGitignore(repo: string): Promise<void> {
  const file = path.join(repo, ".gitignore");
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch {
    // No .gitignore yet — we'll create it.
  }

  const already = current.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed === IGNORE_ENTRY || trimmed === ".orca";
  });
  if (already) return;

  // Start the new entry on its own line: respect an existing trailing newline, add one
  // when the file ends mid-line, and write nothing extra for an empty/absent file.
  const prefix = current.length === 0 || current.endsWith("\n") ? current : `${current}\n`;
  await writeFile(file, `${prefix}${IGNORE_ENTRY}\n`);
}

/**
 * Write the assembled config to `<repo>/.orca.json` (pretty, newline-terminated) and
 * ensure `.orca/` is git-ignored. Refuses when any config already exists — of either
 * supported kind, via the loader's own `findConfig` — unless `force` is set, so a
 * re-run never silently clobbers a file the user may have since hand-edited. Returns
 * the path written, for the caller's next-steps hint.
 */
export async function writeConfig(
  repo: string,
  input: OrcaConfigInput,
  options: { force?: boolean | undefined } = {},
): Promise<string> {
  const existing = await findConfig(repo);
  if (existing && !options.force) {
    throw new CliError(`config already exists: ${existing}\nRe-run with --force to overwrite it.`);
  }

  const target = path.join(repo, CONFIG_FILENAME);
  await writeFile(target, `${JSON.stringify(input, null, 2)}\n`);
  await ensureGitignore(repo);
  return target;
}

// ── Interactive prompts ───────────────────────────────────────
// On a TTY without --yes, init confirms each detected value before writing. Crucially
// the prompts don't build config themselves: they resolve the SAME {base, github,
// remote} shape the CLI flags do, which is then fed through the one assembleConfig
// path. So a prompted answer and the equivalent flag produce byte-identical configs.

/** Ask one question, returning the trimmed answer or `fallback` when the user just
 *  hits enter. The real implementation wraps readline; tests inject a scripted one. */
export type Ask = (question: string, fallback: string) => Promise<string>;

/** The flag-shaped decision assembleConfig consumes — what both prompts and CLI flags
 *  resolve to. */
interface ResolvedChoices {
  base: string;
  github: boolean;
  remote?: string | undefined;
}

/**
 * Walk the user through the few choices init pins, each pre-filled with the flag value
 * if given, else the detected value. Returns a fully-resolved decision; it never
 * writes or validates — that stays assembleConfig's job.
 */
export async function promptForChoices(
  detected: { base: string; github: GithubDetection },
  flags: { base?: string | undefined; github?: boolean | undefined; remote?: string | undefined },
  ask: Ask,
): Promise<ResolvedChoices> {
  const base = await ask("Base branch", flags.base ?? detected.base);

  const githubDefault = flags.github ?? detected.github.available;
  const answer = await ask("Open PRs on GitHub? (y/n)", githubDefault ? "y" : "n");
  const github = /^y/i.test(answer.trim());
  if (!github) return { base, github: false };

  const remote = await ask(
    "Git remote to push to",
    flags.remote ?? detected.github.remote ?? "origin",
  );
  return { base, github: true, remote };
}

/** Build the real readline-backed asker. Prompts go to stderr (they're progress, not
 *  result), keeping stdout clean; an empty line falls back to the shown default. */
function createAsker(): { ask: Ask; close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask: Ask = async (question, fallback) =>
    (await rl.question(`${question} [${fallback}]: `)).trim() || fallback;
  return { ask, close: () => rl.close() };
}

// ── Command entry ─────────────────────────────────────────────
// Ties the pieces together: gate on Claude being installed, learn about the repo,
// resolve the choices (prompted on a TTY, else straight from flags + detections),
// assemble the minimal config, and write it.

/** Injectable collaborators, so the command's test needn't shell out to a real `claude`
 *  or attach a real TTY. When `ask` is given, init prompts through it (treated as an
 *  interactive session unless --yes); absent, it builds the real readline asker only
 *  when stdin is a TTY. */
export interface InitDeps {
  checkClaude: typeof checkClaude;
  ask?: Ask | undefined;
}

/**
 * `orca init` — detect a repo's settings, write a minimal `.orca.json`, and git-ignore
 * Orca's scratch dir. Refuses on a non-git dir or an uninstalled Claude (both one-line
 * CliErrors, exit 1) and won't clobber an existing config without --force.
 */
export async function run(args: string[], deps: InitDeps = { checkClaude }): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: "string" }, // override the detected base branch
      github: { type: "boolean" }, // use a GitHub PR sink (default: local)
      remote: { type: "string" }, // the remote to push to (default: origin)
      yes: { type: "boolean" }, // non-interactive; prompt path lands next slice
      force: { type: "boolean" }, // overwrite an existing config
      repo: { type: "string" }, // (global) target repo (default: cwd)
    },
  });

  // Gate: init writes a config whose whole purpose is to drive Claude Code, so stop
  // early if it isn't even installed. ping:false keeps this free — install check only;
  // login verification is `orca doctor`'s job, not init's.
  const health = await deps.checkClaude({ ping: false });
  if (!health.installed) {
    throw new CliError(
      health.error ?? 'Claude Code is not installed. Install it, then re-run "orca init".',
    );
  }

  // Resolve the target repo (--repo, else cwd) to its git root — also the config's home.
  const repo = await gitRoot(path.resolve(values.repo ?? process.cwd()));

  // Learn what we can; these are independent reads.
  const [base, github, packageManager] = await Promise.all([
    detectBase(repo),
    detectGithub(repo),
    detectPackageManager(repo),
  ]);

  // Resolve the choices. With --yes or no TTY we take flags + detections as-is; on a
  // TTY (or an injected asker) we confirm each value interactively. Either way the
  // result is the same flag shape, assembled by the one assembleConfig path.
  const flags: AssembleInput["flags"] = {
    base: values.base,
    github: values.github,
    remote: values.remote,
  };
  const interactive = !values.yes && (deps.ask !== undefined || Boolean(process.stdin.isTTY));
  let resolved: AssembleInput["flags"] = flags;
  if (interactive) {
    if (deps.ask) {
      resolved = await promptForChoices({ base, github }, flags, deps.ask);
    } else {
      const asker = createAsker();
      try {
        resolved = await promptForChoices({ base, github }, flags, asker.ask);
      } finally {
        asker.close();
      }
    }
  }

  const input = assembleConfig({ detected: { base, github }, flags: resolved });

  const target = await writeConfig(repo, input, { force: values.force });

  // Result → stdout; a terse summary plus what to do next. Show the path relative to
  // cwd (just ".orca.json" in the common case), but fall back to the absolute path when
  // --repo points elsewhere so we don't print a long "../../.." chain.
  const rel = path.relative(process.cwd(), target);
  const where = rel && !rel.startsWith("..") ? rel : target;
  const prLabel =
    input.pr?.kind === "github"
      ? `GitHub${input.pr.remote ? ` (${input.pr.remote})` : ""}`
      : "local";
  const lines = [`Wrote ${where}`, `  base: ${input.base}`, `  PRs:  ${prLabel}`];
  if (packageManager) lines.push(`  pkg:  ${packageManager}`); // informational only; not persisted
  lines.push(
    "",
    "Next:",
    "  orca doctor   # verify Claude is logged in",
    "  orca list     # see available recipes",
  );
  console.log(lines.join("\n"));
}
