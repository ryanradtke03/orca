import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeMessenger } from "@orchestra/messenger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../src/cli-error.js";
import { run as describeCmd } from "../src/commands/describe.js";
import { run as listCmd } from "../src/commands/list.js";
import { buildInput, run as runCmd } from "../src/commands/run.js";
import { run as runsCmd } from "../src/commands/runs.js";

/** Capture console.log output across a command invocation. */
async function capture(fn: () => Promise<void>): Promise<string> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await fn();
    return spy.mock.calls.map((c) => c.join(" ")).join("\n");
  } finally {
    spy.mockRestore();
  }
}

describe("list", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "orca-cmd-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prints every recipe and the chain", async () => {
    const out = await capture(() => listCmd(["--repo", dir]));
    expect(out).toContain("bug-to-pr");
    expect(out).toContain("fix-ci");
    expect(out.trim().split("\n")).toHaveLength(8);
  });

  it("emits JSON with --json", async () => {
    const out = await capture(() => listCmd(["--repo", dir, "--json"]));
    const parsed = JSON.parse(out) as { name: string }[];
    expect(parsed.map((r) => r.name)).toContain("bug-to-pr");
  });
});

describe("describe", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "orca-cmd-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prints the recipe's JSON input schema", async () => {
    const out = await capture(() => describeCmd(["bug-to-pr", "--repo", dir]));
    const schema = JSON.parse(out) as { type?: string };
    expect(schema.type).toBe("object");
  });

  it("errors with no recipe name", async () => {
    await expect(describeCmd(["--repo", dir])).rejects.toBeInstanceOf(CliError);
  });

  it("errors on an unknown recipe", async () => {
    await expect(describeCmd(["nope", "--repo", dir])).rejects.toBeInstanceOf(CliError);
  });
});

describe("runs", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "orca-cmd-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports an empty trace dir", async () => {
    const out = await capture(() => runsCmd(["--repo", dir]));
    expect(out).toContain("no runs yet");
  });

  it("rejects a non-positive --limit", async () => {
    await expect(runsCmd(["--repo", dir, "--limit", "0"])).rejects.toBeInstanceOf(CliError);
  });
});

describe("run · input assembly", () => {
  it("merges --input-json with --set overrides and coerces types", () => {
    const input = buildInput('{"report":"bug"}', ["issue=42", "draft=true", "test=pnpm check"]);
    expect(input).toEqual({ report: "bug", issue: 42, draft: true, test: "pnpm check" });
  });

  it("rejects non-object --input-json", () => {
    expect(() => buildInput("[1,2]", [])).toThrow(CliError);
    expect(() => buildInput("not json", [])).toThrow(CliError);
  });

  it("rejects a --set without =", () => {
    expect(() => buildInput(undefined, ["bogus"])).toThrow(CliError);
  });
});

describe("run · guards", () => {
  let dir: string;
  const fake = { messenger: new FakeMessenger({ fixtures: [] }) };
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "orca-cmd-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("errors with no recipe name (before any run starts)", async () => {
    await expect(runCmd(["--repo", dir], fake)).rejects.toBeInstanceOf(CliError);
  });

  it("errors on an unknown recipe (before any spend)", async () => {
    await expect(runCmd(["nope", "--repo", dir], fake)).rejects.toBeInstanceOf(CliError);
  });
});
