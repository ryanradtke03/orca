// The pieces bug-to-pr's review round relies on: pr-review can request changes for
// missing work (no line to pin it to), and fix-ci runs on review feedback even when
// its command is already green, with the issue and the feedback in the prompt.
import type { Ctx, GateContext, Task } from "@orchestra/engine";
import { describe, expect, it } from "vitest";
import { fixCi } from "../src/fix-ci/index.js";
import { ReviewSchema } from "../src/pr-review/index.js";

describe("pr-review: unaddressed", () => {
  const base = { summary: "s", comments: [] };

  it("request_changes with only an unaddressed item is a valid review", () => {
    const r = { ...base, verdict: "request_changes", unaddressed: ["cap still at 200"] };
    expect(ReviewSchema.safeParse(r).success).toBe(true);
  });

  it("approving while listing unaddressed work is rejected", () => {
    const r = { ...base, verdict: "approve", unaddressed: ["cap still at 200"] };
    expect(ReviewSchema.safeParse(r).success).toBe(false);
  });

  it("treats a missing unaddressed list as empty", () => {
    const parsed = ReviewSchema.parse({ ...base, verdict: "approve" });
    expect(parsed.unaddressed).toEqual([]);
  });
});

describe("fix-ci: protected files", () => {
  const noFileChanges = fixCi.gates.find((g) => g.name === "noFileChanges");
  const check = (changedFiles: string[]) =>
    noFileChanges?.check({ changedFiles } as unknown as GateContext);

  it("rejects CI, lockfile and orca config edits (the issue text can ask for them)", async () => {
    for (const f of [
      ".github/workflows/ci.yml",
      "pnpm-lock.yaml",
      "packages/a/yarn.lock",
      ".orca.json",
    ]) {
      expect((await check([f]))?.ok, f).toBe(false);
    }
  });

  it("still allows source edits", async () => {
    expect((await check(["packages/recipes/src/pr-describe/index.ts"]))?.ok).toBe(true);
  });
});

describe("fix-ci: issue and feedback", () => {
  /** A Ctx whose exec reports the command as green (code 0) or red (code 1). */
  const ctxWith = (code: number) =>
    ({ exec: async () => ({ code, output: code ? "1 test failed" : "" }) }) as unknown as Ctx;
  const promptOf = (task: Task | undefined) => (task ? fixCi.worker(task, {} as never).prompt : "");

  it("skips the worker when green and there's no feedback", async () => {
    expect(await fixCi.plan(fixCi.input.parse({ command: "t" }), ctxWith(0))).toEqual([]);
  });

  it("runs on review feedback even when green, and puts it in the prompt", async () => {
    const [task] = await fixCi.plan(
      fixCi.input.parse({ command: "t", feedback: ["Not resolved yet: cap at 200"] }),
      ctxWith(0),
    );
    expect(task?.goal).toContain("Address the review feedback");
    const prompt = promptOf(task);
    expect(prompt).toContain("- Not resolved yet: cap at 200");
    expect(prompt).not.toContain("Current failure");
  });

  it("puts the bug report in the prompt when given", async () => {
    const [task] = await fixCi.plan(
      fixCi.input.parse({ command: "t", issue: "big diffs get no description" }),
      ctxWith(1),
    );
    const prompt = promptOf(task);
    expect(prompt).toContain("big diffs get no description");
    expect(prompt).toContain("Fix everything the report describes");
    expect(prompt).toContain("1 test failed");
  });
});
