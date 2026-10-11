import type { Ctx } from "@orchestra/engine";
import { describe, expect, it } from "vitest";
import { prDescribe } from "../../src/pr-describe/index.js";

/** A unified-diff block for one file, padded so a handful overflow the prompt budget. */
function fileDiff(pathName: string): string {
  const added = Array.from(
    { length: 60 },
    (_, i) => `+  const someDescriptiveLocalName${i} = computeValue(${i}) + offset;`,
  ).join("\n");
  return [
    `diff --git a/${pathName} b/${pathName}`,
    `--- a/${pathName}`,
    `+++ b/${pathName}`,
    "@@ -1,1 +1,61 @@",
    " export const x = 1;",
    added,
  ].join("\n");
}

/** Build a diff over `n` distinct files, large enough to pass the 20k prompt budget. */
function bigDiff(n: number): { diff: string; files: string[] } {
  const files = Array.from({ length: n }, (_, i) => `packages/engine/src/gen/file${i}.ts`);
  return { diff: files.map(fileDiff).join("\n"), files };
}

/** A minimal Ctx for plan(): it only reads ctx.exec and ctx.repo. */
function fakeCtx(diff: string): Ctx {
  return {
    repo: "/nonexistent-repo-for-issue-80", // no PR template to read
    exec: async (cmd: string) => ({
      code: 0,
      output: cmd.startsWith("git diff") ? diff : "", // git log is empty
    }),
  } as unknown as Ctx;
}

async function planContext(diff: string) {
  const tasks = await prDescribe.plan({ base: "main", head: "HEAD", evidence: [] }, fakeCtx(diff));
  return tasks[0]?.context as { files: string[]; diff: string } | undefined;
}

describe("pr-describe plan() on a large diff (issue #80)", () => {
  it("only asks the worker to cover files it was actually shown", async () => {
    const { diff } = bigDiff(15);
    const ctx = await planContext(diff);
    expect(ctx).toBeDefined();
    // The mentionsOnlyDiffFiles gate requires every file in `files` to be described,
    // but the worker only sees `diff`. Every required file must appear in the diff
    // the worker is given — otherwise the gates are unsatisfiable and the run stalls.
    const unseen = ctx!.files.filter((f) => !ctx!.diff.includes(f));
    expect(unseen).toEqual([]);
  });

  it("keeps file list and shown diff consistent on a small diff", async () => {
    const { diff } = bigDiff(2);
    const ctx = await planContext(diff);
    const unseen = ctx!.files.filter((f) => !ctx!.diff.includes(f));
    expect(unseen).toEqual([]);
  });
});
