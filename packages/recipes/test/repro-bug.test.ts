// repro-bug's gates and finish, driven directly with a fake gate context: where the
// repro file may live (root or a package, for monorepos), and that the commands the
// gates run — and the one handed to fix-ci — target the file the worker wrote.
import type { GateContext, Task, TaskResult } from "@orchestra/engine";
import { describe, expect, it } from "vitest";
import { reproBug } from "../src/repro-bug/index.js";

const task: Task = {
  id: "repro",
  goal: "",
  dependsOn: [],
  context: {
    report: "median is wrong",
    reproFile: "test/repro/issue-80.test.ts",
    test: "pnpm vitest run",
    example: "",
  },
};

function gate(name: string) {
  const g = reproBug.gates.find((x) => x.name === name);
  if (!g) throw new Error(`no gate ${name}`);
  return g;
}

/** A gate context whose exec records each command and exits with `code`. */
function gctx(changedFiles: string[], code = 1) {
  const ran: string[] = [];
  const ctx: GateContext = {
    worktree: "/wt",
    task,
    diff: "",
    changedFiles,
    output: "",
    exec: async (cmd) => {
      ran.push(cmd);
      return { code, stdout: "", stderr: "" };
    },
  };
  return { ctx, ran };
}

const diffFor = (file: string) =>
  `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n`;

describe("repro-bug gates", () => {
  it("onlyTouches accepts the repro file at the root or under a package", async () => {
    for (const file of [
      "test/repro/issue-80.test.ts",
      "packages/recipes/test/repro/issue-80.test.ts",
    ]) {
      expect(await gate("onlyTouches").check(gctx([file]).ctx)).toEqual({ ok: true });
    }
  });

  it("onlyTouches still rejects source edits and other tests", async () => {
    const result = await gate("onlyTouches").check(
      gctx(["packages/recipes/test/repro/issue-80.test.ts", "packages/recipes/src/x.ts"]).ctx,
    );
    expect(result).toEqual({
      ok: false,
      reasons: ["changed a file outside the allowed paths: packages/recipes/src/x.ts"],
    });
  });

  it("commandFails runs the test file the worker actually wrote", async () => {
    const { ctx, ran } = gctx(["packages/recipes/test/repro/issue-80.test.ts"]);
    await gate("commandFails").check(ctx);
    expect(ran).toEqual(["pnpm vitest run packages/recipes/test/repro/issue-80.test.ts"]);
  });
});

describe("repro-bug finish", () => {
  const result = (over: Partial<TaskResult>): TaskResult => ({
    task,
    ok: true,
    attempts: 1,
    costUsd: 0,
    ...over,
  });

  it("hands on the command for the file in the accepted diff", async () => {
    const out = await reproBug.finish(
      [result({ diff: diffFor("packages/recipes/test/repro/issue-80.test.ts") })],
      {} as never,
    );
    expect(out).toMatchObject({
      reproduced: true,
      reproFile: "packages/recipes/test/repro/issue-80.test.ts",
      command: "pnpm vitest run packages/recipes/test/repro/issue-80.test.ts",
    });
  });

  it("reports the worker's CANNOT_REPRODUCE verdict as the reason", async () => {
    const out = await reproBug.finish(
      [result({ ok: false, output: "CANNOT_REPRODUCE: median already averages" })],
      {} as never,
    );
    expect(out).toMatchObject({ cannotReproduce: true, reason: "median already averages" });
  });

  it("falls back to the gate reasons when the worker gave no verdict", async () => {
    const out = await reproBug.finish(
      [result({ ok: false, output: "wrote the test", failures: ["`x` passed"] })],
      {} as never,
    );
    expect(out).toMatchObject({ cannotReproduce: false, reason: "`x` passed" });
  });
});
