import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Gate, Task } from "../types.js";

// Count how many times a pattern matches in a string. The pattern is copied with
// the global flag so a `g`-less (or stateful `g`) RegExp still counts every hit.
function count(pattern: RegExp, text: string): number {
  const rx = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  return (text.match(rx) ?? []).length;
}

/**
 * Reject the attempt if a pattern matches fewer times in any file than it did at
 * HEAD. Used to stop a worker from deleting assertions (`expect(`) or whole tests
 * (`it(` / `test(`) to make a suite pass — it may change what a test expects, not
 * whether it checks anything.
 *
 * `files` is a function of the task so a recipe can scope it to the test files it
 * found in plan(), the same way `commandPasses` reads its command from the task.
 */
export function countNotLess(pattern: RegExp, files: (task: Task) => string[]): Gate {
  return {
    name: "countNotLess",
    async check(ctx) {
      const reasons: string[] = [];
      for (const file of files(ctx.task)) {
        const shown = await ctx.exec(`git show HEAD:${file}`);
        // A file that didn't exist at HEAD has no baseline to drop below.
        const before = shown.code === 0 ? count(pattern, shown.stdout) : 0;
        const after = count(pattern, await readFile(path.join(ctx.worktree, file), "utf8"));
        if (after < before) {
          reasons.push(`${file}: ${pattern} dropped from ${before} to ${after}`);
        }
      }
      return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
    },
  };
}
