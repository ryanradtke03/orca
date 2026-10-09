import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../src/cli-error.js";
import {
  type Ask,
  assembleConfig,
  detectBase,
  detectGithub,
  detectPackageManager,
  gitRoot,
  run as initRun,
  promptForChoices,
  writeConfig,
} from "../src/commands/init.js";
import { validateConfig } from "../src/config.js";

/** A scripted asker that mirrors the real one's contract: an empty scripted answer
 *  (a bare "enter") resolves to the shown fallback. */
function scriptedAsk(...answers: string[]): Ask {
  let i = 0;
  return async (_question, fallback) => {
    const answer = answers[i++];
    return answer === undefined || answer === "" ? fallback : answer;
  };
}

/** A stubbed doctor check, so the command test needn't shell out to a real `claude`. */
const installed = { checkClaude: async () => ({ installed: true, apiKeyInEnv: false }) };
const notInstalled = {
  checkClaude: async () => ({ installed: false, apiKeyInEnv: false, error: "claude not found" }),
};

const run = promisify(execFile);

/** Create an empty git repo on the given initial branch. No commit needed — the
 *  detections init relies on all resolve against an unborn branch. */
async function initRepo(dir: string, branch = "main"): Promise<void> {
  await run("git", ["init", "-b", branch], { cwd: dir });
}

describe("gitRoot", () => {
  let dir: string;
  beforeEach(async () => {
    // realpath so the comparison survives macOS's /var → /private/var symlink, which
    // `git rev-parse --show-toplevel` already resolves.
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "orca-init-")));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the repo root for the repo directory itself", async () => {
    await initRepo(dir);
    expect(await gitRoot(dir)).toBe(dir);
  });

  it("resolves a nested subdirectory up to the repo root", async () => {
    await initRepo(dir);
    const nested = path.join(dir, "packages", "deep");
    await run("mkdir", ["-p", nested]);
    expect(await gitRoot(nested)).toBe(dir);
  });

  it("throws a CliError (exit 1) for a non-git directory", async () => {
    try {
      await gitRoot(dir); // no `git init` ran
      throw new Error("expected gitRoot to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(1);
      expect((err as CliError).message).toContain("not a git repository");
    }
  });
});

describe("detectBase", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "orca-init-")));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the current branch of a fresh repo (main)", async () => {
    await initRepo(dir, "main");
    expect(await detectBase(dir)).toBe("main");
  });

  it("honours a non-conventional initial branch", async () => {
    await initRepo(dir, "master");
    expect(await detectBase(dir)).toBe("master");
  });

  it("prefers the remote's default branch (origin/HEAD) over the checkout", async () => {
    await initRepo(dir, "main");
    // Point origin/HEAD at a different branch without needing a real remote.
    await run("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop"], {
      cwd: dir,
    });
    expect(await detectBase(dir)).toBe("develop");
  });
});

describe("detectGithub", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "orca-init-")));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is unavailable when the repo has no remote (never touches gh)", async () => {
    await initRepo(dir);
    expect(await detectGithub(dir)).toEqual({ available: false });
  });
});

describe("detectPackageManager", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "orca-init-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns undefined with no lockfile", async () => {
    expect(await detectPackageManager(dir)).toBeUndefined();
  });

  it("recognises a pnpm lockfile", async () => {
    await writeFile(path.join(dir, "pnpm-lock.yaml"), "");
    expect(await detectPackageManager(dir)).toBe("pnpm");
  });

  it("recognises a yarn lockfile", async () => {
    await writeFile(path.join(dir, "yarn.lock"), "");
    expect(await detectPackageManager(dir)).toBe("yarn");
  });

  it("prefers pnpm when several lockfiles coexist", async () => {
    await writeFile(path.join(dir, "pnpm-lock.yaml"), "");
    await writeFile(path.join(dir, "package-lock.json"), "{}");
    expect(await detectPackageManager(dir)).toBe("pnpm");
  });
});

describe("assembleConfig", () => {
  const localDetected = { base: "main", github: { available: false } } as const;

  it("writes only base when the PR sink stays local (default omitted)", () => {
    const input = assembleConfig({ detected: localDetected, flags: {} });
    expect(input).toEqual({ base: "main" });
    // non-default fields only — no pr/backend/limits leak into the file
    expect(Object.keys(input)).toEqual(["base"]);
  });

  it("accepts a detected GitHub sink on an origin remote without pinning the remote", () => {
    const input = assembleConfig({
      detected: { base: "main", github: { available: true } },
      flags: {},
    });
    expect(input).toEqual({ base: "main", pr: { kind: "github" } });
  });

  it("pins a detected non-origin remote", () => {
    const input = assembleConfig({
      detected: { base: "main", github: { available: true, remote: "upstream" } },
      flags: {},
    });
    expect(input.pr).toEqual({ kind: "github", remote: "upstream" });
  });

  it("lets --github force a GitHub sink even when detection says unavailable", () => {
    const input = assembleConfig({ detected: localDetected, flags: { github: true } });
    expect(input.pr).toEqual({ kind: "github" });
  });

  it("lets --base override the detected branch", () => {
    const input = assembleConfig({ detected: localDetected, flags: { base: "develop" } });
    expect(input.base).toBe("develop");
  });

  it("lets --remote override detection but drops it when it is origin", () => {
    const withFlag = assembleConfig({
      detected: { base: "main", github: { available: true, remote: "upstream" } },
      flags: { remote: "fork" },
    });
    expect(withFlag.pr).toEqual({ kind: "github", remote: "fork" });

    const originFlag = assembleConfig({
      detected: { base: "main", github: { available: true, remote: "upstream" } },
      flags: { github: true, remote: "origin" },
    });
    expect(originFlag.pr).toEqual({ kind: "github" }); // origin is the default — not pinned
  });

  it("produces an object the loader accepts (one config definition, not two)", () => {
    const input = assembleConfig({
      detected: { base: "main", github: { available: true } },
      flags: {},
    });
    // The same validateConfig loadConfig runs resolves it cleanly, with defaults filled.
    const resolved = validateConfig(input);
    expect(resolved.base).toBe("main");
    expect(resolved.pr).toEqual({ kind: "github" });
    expect(resolved.backend).toBe("cli"); // default applied on load, not written to file
  });
});

describe("writeConfig", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "orca-init-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const input = { base: "main", pr: { kind: "github" } } as const;

  it("writes a pretty, newline-terminated .orca.json the loader accepts", async () => {
    const target = await writeConfig(dir, input);
    expect(target).toBe(path.join(dir, ".orca.json"));

    const text = await readFile(target, "utf8");
    expect(text.endsWith("\n")).toBe(true); // newline-terminated
    expect(text).toContain('\n  "base"'); // 2-space indented (pretty)
    expect(validateConfig(JSON.parse(text))).toMatchObject({
      base: "main",
      pr: { kind: "github" },
    });
  });

  it("creates a .gitignore with .orca/ when none exists", async () => {
    await writeConfig(dir, input);
    const ignore = await readFile(path.join(dir, ".gitignore"), "utf8");
    expect(ignore).toContain(".orca/");
  });

  it("appends to an existing .gitignore without clobbering it, and never duplicates", async () => {
    await writeFile(path.join(dir, ".gitignore"), "node_modules\n");
    await writeConfig(dir, input);
    await writeConfig(dir, input, { force: true }); // second write must not re-append

    const ignore = await readFile(path.join(dir, ".gitignore"), "utf8");
    expect(ignore).toContain("node_modules"); // existing lines preserved
    expect(ignore.match(/^\.orca\/$/gm)).toHaveLength(1); // exactly one .orca/ entry
  });

  it("refuses to overwrite an existing config and leaves it untouched (exit 1)", async () => {
    await writeConfig(dir, input);
    const before = await readFile(path.join(dir, ".orca.json"), "utf8");

    try {
      await writeConfig(dir, { base: "changed" });
      throw new Error("expected writeConfig to refuse");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(1);
    }
    // the original file is unchanged — the refusal is a no-op on disk
    expect(await readFile(path.join(dir, ".orca.json"), "utf8")).toBe(before);
  });

  it("overwrites with --force", async () => {
    await writeConfig(dir, input);
    await writeConfig(dir, { base: "develop" }, { force: true });
    const text = await readFile(path.join(dir, ".orca.json"), "utf8");
    expect(JSON.parse(text)).toEqual({ base: "develop" });
  });

  it("refuses when a hand-authored orca.config.ts already exists (via findConfig)", async () => {
    await writeFile(path.join(dir, "orca.config.ts"), `export default { base: "x" };\n`);
    await expect(writeConfig(dir, input)).rejects.toBeInstanceOf(CliError);
  });
});

describe("init run (command)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "orca-init-")));
    await initRepo(dir); // git init -b main
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a valid minimal config for a fresh repo (--yes path)", async () => {
    await initRun(["--repo", dir, "--yes"], installed);
    const text = await readFile(path.join(dir, ".orca.json"), "utf8");
    // no remote + no --github → local sink is the default and omitted; only base pinned
    expect(JSON.parse(text)).toEqual({ base: "main" });
    expect(validateConfig(JSON.parse(text))).toMatchObject({ pr: { kind: "local" } });
  });

  it("honours --base and --github flags", async () => {
    await initRun(["--repo", dir, "--base", "develop", "--github", "--yes"], installed);
    expect(JSON.parse(await readFile(path.join(dir, ".orca.json"), "utf8"))).toEqual({
      base: "develop",
      pr: { kind: "github" },
    });
  });

  it("refuses a second run without --force, and --force overwrites", async () => {
    await initRun(["--repo", dir, "--yes"], installed);
    await expect(initRun(["--repo", dir, "--yes"], installed)).rejects.toBeInstanceOf(CliError);
    await initRun(["--repo", dir, "--base", "x", "--force", "--yes"], installed);
    expect(JSON.parse(await readFile(path.join(dir, ".orca.json"), "utf8"))).toEqual({ base: "x" });
  });

  it("gates on Claude being installed (CliError exit 1, nothing written)", async () => {
    await expect(initRun(["--repo", dir, "--yes"], notInstalled)).rejects.toBeInstanceOf(CliError);
    await expect(readFile(path.join(dir, ".orca.json"), "utf8")).rejects.toThrow();
  });

  it("refuses a non-git directory", async () => {
    const plain = await mkdtemp(path.join(tmpdir(), "orca-plain-"));
    try {
      await expect(initRun(["--repo", plain, "--yes"], installed)).rejects.toBeInstanceOf(CliError);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  const read = async () => JSON.parse(await readFile(path.join(dir, ".orca.json"), "utf8"));

  it("interactive run writes the same config the equivalent flags would", async () => {
    // No --yes, asker injected → interactive path. Answers: base=enter, GitHub=y, remote=enter.
    await initRun(["--repo", dir], { ...installed, ask: scriptedAsk("", "y", "") });
    expect(await read()).toEqual({ base: "main", pr: { kind: "github" } });
  });

  it("--yes skips prompts even when an asker is present", async () => {
    const ask: Ask = async () => {
      throw new Error("prompt should not run under --yes");
    };
    await initRun(["--repo", dir, "--yes"], { ...installed, ask });
    expect(await read()).toEqual({ base: "main" });
  });
});

describe("promptForChoices", () => {
  const local = { base: "main", github: { available: false } } as const;
  const githubReady = { base: "main", github: { available: true } } as const;

  it("accepting all defaults with no remote matches the --yes (local) path", async () => {
    // base=enter, GitHub=enter (defaults to n since unavailable)
    const choices = await promptForChoices(local, {}, scriptedAsk("", ""));
    expect(assembleConfig({ detected: local, flags: choices })).toEqual(
      assembleConfig({ detected: local, flags: {} }), // the equivalent flags
    );
    expect(assembleConfig({ detected: local, flags: choices })).toEqual({ base: "main" });
  });

  it("choosing GitHub on origin matches the --github path", async () => {
    // base=enter, GitHub=y, remote=enter (origin)
    const choices = await promptForChoices(local, {}, scriptedAsk("", "y", ""));
    expect(assembleConfig({ detected: local, flags: choices })).toEqual(
      assembleConfig({ detected: local, flags: { github: true } }),
    );
    expect(assembleConfig({ detected: local, flags: choices })).toEqual({
      base: "main",
      pr: { kind: "github" },
    });
  });

  it("a typed base overrides the detected default", async () => {
    const choices = await promptForChoices(local, {}, scriptedAsk("develop", ""));
    expect(choices.base).toBe("develop");
  });

  it("lets the user decline GitHub even when detection offers it", async () => {
    // GitHub default is 'y' (available), user answers 'n'
    const choices = await promptForChoices(githubReady, {}, scriptedAsk("", "n"));
    expect(choices.github).toBe(false);
    expect(assembleConfig({ detected: githubReady, flags: choices })).toEqual({ base: "main" });
  });

  it("pins a typed non-origin remote", async () => {
    const choices = await promptForChoices(githubReady, {}, scriptedAsk("", "y", "upstream"));
    expect(assembleConfig({ detected: githubReady, flags: choices }).pr).toEqual({
      kind: "github",
      remote: "upstream",
    });
  });
});
