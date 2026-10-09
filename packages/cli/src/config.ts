// The validated shape of an Orca config, plus the `defineConfig` authoring helper.
//
// This module only describes and validates *scalars and choices* — which repo,
// how big a run can get, where output goes, local vs GitHub PRs. It deliberately
// does NOT build the live messenger / recipes / PR-sink objects the engine needs;
// that is `buildEngine(config)` in engine-factory.ts (step 3). The seam: this file
// returns plain, serializable data; step 3 turns that data into an engine.
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { EngineLimits, KeepWorktrees } from "@orchestra/engine";
import { register } from "tsx/esm/api";
import { z } from "zod";
import { CliError } from "./cli-error.js";

// Per-run limits. Mirrors the engine's EngineLimits keys exactly — the `satisfies`
// guard makes this file fail to typecheck if the engine ever renames or adds one,
// so the two can't silently drift. We give each field a validator but NO default:
// leaving a limit out means "let the engine's DEFAULT_LIMITS decide", which keeps
// those numbers (2 / 3 / 3 / 30min) as the single source of truth in engine.ts.
const limitsShape = {
  maxWorkers: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  maxCostUsd: z.number().positive(), // dollars — fractional budgets like 2.5 are valid, so not .int()
  maxDurationMs: z.number().int().positive(),
} satisfies Record<keyof EngineLimits, z.ZodType>;

// The keep-worktrees policy. Tied to the engine's KeepWorktrees union the same way.
const KEEP_WORKTREES = [
  "always",
  "on-failure",
  "never",
] as const satisfies readonly KeepWorktrees[];

export const OrcaConfigSchema = z.object({
  // Target repo. Usually the cwd or the --repo flag wins, so this is just a fallback.
  repo: z.string().optional(),
  // Default base ref for PRs; the --base flag overrides it per run.
  base: z.string().optional(),
  // Where PRs/issues/comments go. A local file sink by default (writes under .orca/),
  // or the real GitHub sink. The discriminator is `kind`; --github flips local → github.
  pr: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("local"), dir: z.string().optional() }),
      z.object({ kind: z.literal("github"), remote: z.string().optional() }),
    ])
    .default({ kind: "local" }),
  // Which messenger to drive. "fake" is the test path and is injected via buildEngine,
  // not usually written in a config file, but it's a valid choice so we allow it.
  backend: z.enum(["cli", "fake"]).default("cli"),
  // Partial so any omitted limit falls through to the engine's DEFAULT_LIMITS.
  limits: z.object(limitsShape).partial().default({}),
  // Left undefined so the engine applies its own default location.
  worktreeDir: z.string().optional(),
  // The engine has no trace-dir default; the CLI defaults it later (step 4) so `orca
  // runs` has somewhere to read from. Here it's just an optional override.
  traceDir: z.string().optional(),
  keepWorktrees: z.enum(KEEP_WORKTREES).optional(),
});

/** A fully-resolved config: the output of parsing, with defaults applied. */
export type OrcaConfig = z.infer<typeof OrcaConfigSchema>;

/**
 * What `loadConfig` returns: an OrcaConfig with `repo` guaranteed present and resolved
 * to an absolute path. The schema keeps `repo` optional (it's just a fallback field),
 * but loadConfig always resolves one, so downstream consumers like `buildEngine` can
 * rely on it without re-checking.
 */
export type ResolvedOrcaConfig = OrcaConfig & { repo: string };

/** What an author writes in orca.config.ts — every field optional (defaults not yet applied). */
export type OrcaConfigInput = z.input<typeof OrcaConfigSchema>;

/**
 * Typed-identity helper for `orca.config.ts` authors, mirroring the engine's
 * `defineRecipe`. It returns its argument unchanged at runtime; its only job is to
 * give editors the OrcaConfig input type so a mistake is caught while you type:
 *
 *   export default defineConfig({ pr: { kind: "github" } });
 */
export function defineConfig(config: OrcaConfigInput): OrcaConfigInput {
  return config;
}

// ── Discovery & loading ───────────────────────────────────────
// These return the RAW object read from disk (or {} when there is no file). They do
// not validate — that's the schema's job in the next sub-step. The two concerns stay
// separate so an error from "file not found" never looks like an error from "bad shape".

const CONFIG_TS = "orca.config.ts"; // preferred: typed, can use defineConfig
const CONFIG_JSON = ".orca.json"; // fallback: plain data, no toolchain needed

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide which config file to read. An explicit `--config` path wins (resolved
 * against cwd, the way a user expects a flag path to work); otherwise look for the
 * conventional names in the repo root, `orca.config.ts` before `.orca.json`. Returns
 * the absolute path, or null for zero-config (no file). Does not read the file.
 */
export async function findConfig(repo: string, explicit?: string): Promise<string | null> {
  if (explicit) return path.resolve(explicit);
  for (const name of [CONFIG_TS, CONFIG_JSON]) {
    const candidate = path.join(repo, name);
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

// tsx's ESM loader lets Node import a `.ts` file directly. bin/orca.mjs already
// registers it for the real CLI, but tests and `pnpm orca` reach this code by other
// paths, so register on first use and only once — a second register() just adds a
// redundant hook.
let tsxRegistered = false;
function ensureTsx(): void {
  if (tsxRegistered) return;
  register();
  tsxRegistered = true;
}

/** Load a `.ts` config through tsx and return its default export (raw, unvalidated). */
async function loadTsConfig(file: string): Promise<unknown> {
  ensureTsx();
  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
  } catch (err) {
    // A missing explicit --config.ts lands here as a module-resolution error; any
    // other failure is a real fault in the config file (a syntax or import error).
    const notFound = (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND";
    throw new CliError(
      notFound
        ? `config file not found: ${file}`
        : `cannot load ${file}: ${(err as Error).message}`,
    );
  }
  return mod.default ?? {};
}

/** Load a `.json` config (raw, unvalidated). */
async function loadJsonConfig(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new CliError(`config file not found: ${file}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new CliError(`cannot parse ${file}: ${(err as Error).message}`);
  }
}

/**
 * Read the raw config object: the discovered or explicit file, dispatched by
 * extension, or `{}` when there is no config file. Validation and flag-merge come
 * later; the only promise here is "whatever the file literally contains, as data".
 */
export async function readConfigFile(repo: string, explicit?: string): Promise<unknown> {
  const file = await findConfig(repo, explicit);
  if (!file) return {};
  return file.endsWith(".json") ? loadJsonConfig(file) : loadTsConfig(file);
}

// ── Validation ────────────────────────────────────────────────

/** Flatten a ZodError into one line: `field.path: message; other.path: message`.
 *  Mirrors the engine's issue formatting (gates/output.ts, messenger helpers). */
function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * Validate a raw config object against the schema and return a resolved OrcaConfig
 * (defaults applied). A bad shape becomes a CliError — so the top-level catch in
 * index.ts prints one line and exits 1, never a Zod stack trace. A real bug (not a
 * user mistake) is not a CliError and still surfaces normally.
 */
export function validateConfig(raw: unknown): OrcaConfig {
  const result = OrcaConfigSchema.safeParse(raw);
  if (!result.success) throw new CliError(`invalid config: ${zodMessage(result.error)}`);
  return result.data;
}

// ── Flag merge & resolution ───────────────────────────────────

/** The subset of command-line flags that influence config resolution. */
export interface ConfigFlags {
  repo?: string | undefined; // --repo <path>
  base?: string | undefined; // --base <ref>
  github?: boolean | undefined; // --github (flip the PR sink to GitHub)
  config?: string | undefined; // --config <path>
}

/**
 * The one entry point a command calls. Resolves config in precedence order
 * (defaults ← file ← flags), reads the file relative to the target repo, and
 * returns a fully-resolved OrcaConfig: `repo` is absolute and `traceDir` is defaulted
 * so `orca runs` has somewhere to read. No engine is built here — that's step 3.
 */
export async function loadConfig(flags: ConfigFlags = {}): Promise<ResolvedOrcaConfig> {
  const cwd = process.cwd();
  // Where to look for the config file: the flag, else the current directory.
  const searchRoot = path.resolve(flags.repo ?? cwd);
  const fileConfig = validateConfig(await readConfigFile(searchRoot, flags.config));

  // The repo the run acts on. Flags win, then the file, then cwd; always absolute.
  const repo = path.resolve(flags.repo ?? fileConfig.repo ?? cwd);

  // --base overrides the file's default base; --github flips a local sink to GitHub
  // but leaves an already-GitHub sink (and its remote) untouched.
  const base = flags.base ?? fileConfig.base;
  const pr =
    flags.github && fileConfig.pr.kind !== "github" ? { kind: "github" as const } : fileConfig.pr;

  // The engine has no trace-dir default, so the CLI supplies one under the repo.
  // A file-supplied traceDir is honored, resolved relative to the repo if relative.
  const traceDir = fileConfig.traceDir
    ? path.resolve(repo, fileConfig.traceDir)
    : path.join(repo, ".orca", "traces");

  return { ...fileConfig, repo, base, pr, traceDir };
}
