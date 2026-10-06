import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exec } from "../src/exec.js";
import {
  commandFails,
  commandPasses,
  countNotLess,
  failsOnBase,
  failsWithAssertion,
  filesExist,
  noFileChanges,
  noPattern,
  onlyTouches,
  type ParsedFailure,
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

describe("commandFails", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo();
  });
  afterEach(() => cleanup(repo));

  it("passes when the command exits non-zero", async () => {
    const res = await commandFails("exit 1").check(gctx(repo));
    expect(res.ok).toBe(true);
  });

  it("fails when the command exits 0 (the bug isn't shown)", async () => {
    const res = await commandFails("exit 0").check(gctx(repo));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons[0]).toContain("doesn't reproduce");
  });

  it("reads the command from the task", async () => {
    const res = await commandFails((t) => String(t.context["cmd"])).check(
      gctx(repo, { task: task({ cmd: "exit 2" }) }),
    );
    expect(res.ok).toBe(true);
  });
});

describe("failsWithAssertion", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo();
  });
  afterEach(() => cleanup(repo));

  // The parser pulls failures out of whatever `command` prints on stdout.
  const parse = (out: string): ParsedFailure[] => {
    const line = out.trim().split("\n").filter(Boolean).pop() ?? "{}";
    return (JSON.parse(line).fails ?? []) as ParsedFailure[];
  };
  const emit = (fails: ParsedFailure[]) => `echo '${JSON.stringify({ fails })}'`;

  it("passes when every run fails on an assertion with the same set", async () => {
    const cmd = emit([{ name: "median", message: "AssertionError: expected 3 to be 2.5" }]);
    const res = await failsWithAssertion(cmd, parse).check(gctx(repo));
    expect(res.ok).toBe(true);
  });

  it("rejects a crash (TypeError) counted as a reproduction", async () => {
    const cmd = emit([{ name: "slug", message: "TypeError: Cannot read properties of undefined" }]);
    const res = await failsWithAssertion(cmd, parse).check(gctx(repo));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons[0]).toContain("not an assertion");
  });

  it("rejects when no tests failed", async () => {
    const res = await failsWithAssertion(emit([]), parse).check(gctx(repo));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons[0]).toContain("no failing tests");
  });

  it("rejects a flaky repro: the failing set differs between runs", async () => {
    // A counter file makes the first run print "x" and the second "y".
    const cmd =
      "n=$(cat .n 2>/dev/null || echo 0); n=$((n+1)); echo $n > .n; " +
      `if [ "$n" -eq 1 ]; then echo '${JSON.stringify({ fails: [{ name: "x", message: "AssertionError: a" }] })}';` +
      ` else echo '${JSON.stringify({ fails: [{ name: "y", message: "AssertionError: b" }] })}'; fi`;
    const res = await failsWithAssertion(cmd, parse).check(gctx(repo));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons[0]).toContain("flaky");
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

  it("reads the allow-list from the task", async () => {
    const gate = onlyTouches((t) => t.context["files"] as string[]);
    const ctx = gctx("/tmp", {
      task: task({ files: ["src/a.ts", "src/b.ts"] }),
      changedFiles: ["src/a.ts"],
    });
    expect((await gate.check(ctx)).ok).toBe(true);

    const outside = gctx("/tmp", {
      task: task({ files: ["src/a.ts"] }),
      changedFiles: ["src/a.ts", "src/c.ts"],
    });
    const res = await gate.check(outside);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons[0]).toContain("src/c.ts");
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

describe("countNotLess", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo({
      "test/x.test.ts": 'it("a", () => { expect(1).toBe(1); expect(2).toBe(2); });\n',
    });
  });
  afterEach(() => cleanup(repo));

  const gate = countNotLess(/\bexpect\(/, (t) => t.context["files"] as string[]);
  const ctx = () => gctx(repo, { task: task({ files: ["test/x.test.ts"] }) });

  it("passes when the count holds (expectations changed, not removed)", async () => {
    await write(
      repo,
      "test/x.test.ts",
      'it("a", () => { expect(1).toBe(2); expect(2).toBe(3); });\n',
    );
    expect((await gate.check(ctx())).ok).toBe(true);
  });

  it("fails when an assertion is deleted", async () => {
    await write(repo, "test/x.test.ts", 'it("a", () => { expect(1).toBe(2); });\n');
    const res = await gate.check(ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons[0]).toContain("dropped from 2 to 1");
  });
});

describe("failsOnBase", () => {
  let repo: string;
  // A `test` that passes only when src/val.ts contains the pattern in the test
  // file — a stand-in for "the test matches the source's behavior".
  const TEST_CMD = "grep -qf test/pattern.txt src/val.ts";
  const gate = failsOnBase(
    () => "HEAD~1",
    "src",
    () => TEST_CMD,
  );

  beforeEach(async () => {
    // base commit: old behavior + a test that expects it
    repo = await makeScratchRepo({ "src/val.ts": "value old\n", "test/pattern.txt": "old" });
    // HEAD: the intentional source change, committed; the test is left stale
    await write(repo, "src/val.ts", "value new\n");
    await exec(repo, "git add -A && git commit -q -m 'intentional change'");
  });
  afterEach(() => cleanup(repo));

  it("passes when the updated test fails on the old source", async () => {
    await write(repo, "test/pattern.txt", "new"); // now expects the new behavior
    const res = await gate.check(gctx(repo, { changedFiles: ["test/pattern.txt"] }));
    expect(res.ok).toBe(true);
  });

  it("fails when the updated test still passes on the old source", async () => {
    await write(repo, "test/pattern.txt", "value"); // matches both old and new
    const res = await gate.check(gctx(repo, { changedFiles: ["test/pattern.txt"] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons[0]).toContain("old code");
  });
});
