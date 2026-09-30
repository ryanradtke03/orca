import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exec } from "../src/exec.js";
import {
  commandPasses,
  filesExist,
  noFileChanges,
  noPattern,
  onlyTouches,
} from "../src/gates/index.js";
import type { GateContext, Task } from "../src/types.js";
import { cleanup, makeScratchRepo, write } from "./helpers.js";

const task = (context: Record<string, unknown> = {}): Task => ({
  id: "t",
  goal: "t",
  dependsOn: [],
  context,
});

function gctx(worktree: string, over: Partial<GateContext> = {}): GateContext {
  return {
    worktree,
    task: over.task ?? task(),
    diff: over.diff ?? "",
    changedFiles: over.changedFiles ?? [],
    exec: (cmd, opts) => exec(worktree, cmd, opts),
  };
}

describe("commandPasses", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo();
  });
  afterEach(() => cleanup(repo));

  it("passes when the command exits 0", async () => {
    const res = await commandPasses("exit 0").check(gctx(repo));
    expect(res.ok).toBe(true);
  });

  it("fails with the exit code and output tail", async () => {
    const res = await commandPasses("echo boom 1>&2; exit 3").check(gctx(repo));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reasons[0]).toContain("exited with 3");
      expect(res.reasons[0]).toContain("boom");
    }
  });

  it("reads the command from the task", async () => {
    const res = await commandPasses((t) => String(t.context["cmd"])).check(
      gctx(repo, { task: task({ cmd: "exit 0" }) }),
    );
    expect(res.ok).toBe(true);
  });
});

describe("noPattern", () => {
  it("flags a pattern only on added lines", async () => {
    const diff = ["+++ b/index.ts", "+// @ts-ignore", "+const ok = 1;", "-const old = 0;"].join(
      "\n",
    );
    const res = await noPattern([/@ts-ignore/]).check(gctx("/tmp", { diff }));
    expect(res.ok).toBe(false);
  });

  it("ignores a match on a context (unchanged) line", async () => {
    const diff = ["+++ b/index.ts", "   // @ts-ignore already here", "+const ok = 1;"].join("\n");
    const res = await noPattern([/@ts-ignore/]).check(gctx("/tmp", { diff }));
    expect(res.ok).toBe(true);
  });

  it("does not flag the +++ file header", async () => {
    const diff = ["+++ b/@ts-ignore.ts", "+const ok = 1;"].join("\n");
    const res = await noPattern([/@ts-ignore/]).check(gctx("/tmp", { diff }));
    expect(res.ok).toBe(true);
  });
});

describe("onlyTouches", () => {
  it("passes when every changed file matches a glob", async () => {
    const res = await onlyTouches(["src/**"]).check(
      gctx("/tmp", { changedFiles: ["src/a.ts", "src/nested/b.ts"] }),
    );
    expect(res.ok).toBe(true);
  });

  it("fails when a file falls outside the allow-list", async () => {
    const res = await onlyTouches(["src/**"]).check(
      gctx("/tmp", { changedFiles: ["src/a.ts", "README.md"] }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons[0]).toContain("README.md");
  });

  it("matches * within a segment but not across slashes", async () => {
    const gate = onlyTouches(["*.ts"]);
    expect((await gate.check(gctx("/tmp", { changedFiles: ["a.ts"] }))).ok).toBe(true);
    expect((await gate.check(gctx("/tmp", { changedFiles: ["src/a.ts"] }))).ok).toBe(false);
  });
});

describe("noFileChanges", () => {
  const protectedPaths = [/\.test\.[cm]?[jt]sx?$/, /^package\.json$/];

  it("passes when no changed file matches a protected pattern", async () => {
    const res = await noFileChanges(protectedPaths).check(
      gctx("/tmp", { changedFiles: ["src/a.ts", "src/b.ts"] }),
    );
    expect(res.ok).toBe(true);
  });

  it("fails and names each protected file that changed", async () => {
    const res = await noFileChanges(protectedPaths).check(
      gctx("/tmp", { changedFiles: ["src/a.ts", "src/a.test.ts", "package.json"] }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reasons.some((r) => r.includes("a.test.ts"))).toBe(true);
      expect(res.reasons.some((r) => r.includes("package.json"))).toBe(true);
      expect(res.reasons.some((r) => r.includes("src/a.ts"))).toBe(false);
    }
  });
});

describe("filesExist", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo();
  });
  afterEach(() => cleanup(repo));

  it("passes when all files exist", async () => {
    await write(repo, "exists.txt", "hi");
    const res = await filesExist(["exists.txt"]).check(gctx(repo));
    expect(res.ok).toBe(true);
  });

  it("fails and names the missing files", async () => {
    const res = await filesExist(["missing.txt"]).check(gctx(repo));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons[0]).toContain("missing.txt");
  });
});
