import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../src/cli-error.js";
import {
  defineConfig,
  findConfig,
  loadConfig,
  OrcaConfigSchema,
  readConfigFile,
  validateConfig,
} from "../src/config.js";

describe("OrcaConfigSchema", () => {
  it("applies zero-config defaults to an empty object", () => {
    const config = OrcaConfigSchema.parse({});
    // The three defaults the schema is responsible for:
    expect(config.pr).toEqual({ kind: "local" });
    expect(config.backend).toBe("cli");
    expect(config.limits).toEqual({});
    // Everything else is an unset optional, not a default.
    expect(config.repo).toBeUndefined();
    expect(config.keepWorktrees).toBeUndefined();
  });

  it("accepts a GitHub PR sink with an optional remote", () => {
    const config = OrcaConfigSchema.parse({ pr: { kind: "github", remote: "upstream" } });
    expect(config.pr).toEqual({ kind: "github", remote: "upstream" });
  });

  it("accepts a partial limits override without re-declaring the rest", () => {
    const config = OrcaConfigSchema.parse({ limits: { maxCostUsd: 2.5 } });
    // Only the one limit is set; the engine fills the others from DEFAULT_LIMITS.
    expect(config.limits).toEqual({ maxCostUsd: 2.5 });
  });

  it("rejects an unknown pr kind", () => {
    const result = OrcaConfigSchema.safeParse({ pr: { kind: "gitlab" } });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive integer limit", () => {
    expect(OrcaConfigSchema.safeParse({ limits: { maxWorkers: 0 } }).success).toBe(false);
  });
});

describe("defineConfig", () => {
  it("returns its argument unchanged", () => {
    const input = { pr: { kind: "github" } } as const;
    expect(defineConfig(input)).toBe(input);
  });
});

describe("discovery & loading", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "orca-config-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns {} when there is no config file (zero-config)", async () => {
    expect(await findConfig(dir)).toBeNull();
    const raw = await readConfigFile(dir);
    expect(raw).toEqual({});
    // and that raw object, parsed, is the zero-config default
    expect(OrcaConfigSchema.parse(raw).pr).toEqual({ kind: "local" });
  });

  it("loads a .orca.json file", async () => {
    await writeFile(path.join(dir, ".orca.json"), JSON.stringify({ base: "develop" }));
    expect(await readConfigFile(dir)).toEqual({ base: "develop" });
  });

  it("loads an orca.config.ts file via tsx and takes its default export", async () => {
    await writeFile(
      path.join(dir, "orca.config.ts"),
      `export default { pr: { kind: "github", remote: "upstream" } };\n`,
    );
    expect(await readConfigFile(dir)).toEqual({ pr: { kind: "github", remote: "upstream" } });
  });

  it("prefers orca.config.ts over .orca.json when both exist", async () => {
    await writeFile(path.join(dir, "orca.config.ts"), `export default { base: "from-ts" };\n`);
    await writeFile(path.join(dir, ".orca.json"), JSON.stringify({ base: "from-json" }));
    expect(await findConfig(dir)).toBe(path.join(dir, "orca.config.ts"));
    expect(await readConfigFile(dir)).toEqual({ base: "from-ts" });
  });

  it("wraps a syntactically broken .orca.json in a CliError", async () => {
    await writeFile(path.join(dir, ".orca.json"), "{ not json");
    await expect(readConfigFile(dir)).rejects.toBeInstanceOf(CliError);
  });

  it("reports a missing explicit config file as a CliError", async () => {
    await expect(readConfigFile(dir, path.join(dir, "nope.json"))).rejects.toThrow(
      /config file not found/,
    );
  });
});

describe("validateConfig", () => {
  it("returns a resolved config with defaults for a valid raw object", () => {
    const config = validateConfig({ base: "develop" });
    expect(config.base).toBe("develop");
    expect(config.pr).toEqual({ kind: "local" });
    expect(config.backend).toBe("cli");
  });

  it("throws a single-line CliError (exit 1) naming the bad field", () => {
    try {
      validateConfig({ limits: { maxWorkers: 0 } });
      throw new Error("expected validateConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const cliErr = err as CliError;
      expect(cliErr.exitCode).toBe(1);
      expect(cliErr.message).not.toContain("\n"); // one line, no stack
      expect(cliErr.message).toContain("limits.maxWorkers"); // points at the field
    }
  });
});

describe("loadConfig", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "orca-load-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lets a flag beat the file", async () => {
    await writeFile(path.join(dir, ".orca.json"), JSON.stringify({ base: "from-file" }));
    const config = await loadConfig({ repo: dir, base: "from-flag", github: true });
    expect(config.base).toBe("from-flag"); // flag beats file
    expect(config.pr).toEqual({ kind: "github" }); // --github flips the local default
  });

  it("falls back to the file value when no flag overrides it", async () => {
    await writeFile(path.join(dir, ".orca.json"), JSON.stringify({ base: "from-file" }));
    const config = await loadConfig({ repo: dir });
    expect(config.base).toBe("from-file"); // file beats default
  });

  it("uses schema defaults when there is no file and no flags", async () => {
    const config = await loadConfig({ repo: dir });
    expect(config.base).toBeUndefined();
    expect(config.pr).toEqual({ kind: "local" });
    expect(config.backend).toBe("cli");
  });

  it("resolves repo to an absolute path and defaults traceDir under it", async () => {
    const config = await loadConfig({ repo: dir });
    expect(config.repo).toBe(path.resolve(dir));
    expect(config.traceDir).toBe(path.join(path.resolve(dir), ".orca", "traces"));
  });

  it("keeps a github remote from the file even when --github is also passed", async () => {
    await writeFile(
      path.join(dir, ".orca.json"),
      JSON.stringify({ pr: { kind: "github", remote: "upstream" } }),
    );
    const config = await loadConfig({ repo: dir, github: true });
    expect(config.pr).toEqual({ kind: "github", remote: "upstream" });
  });
});
