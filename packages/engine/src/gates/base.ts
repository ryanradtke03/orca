import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Gate, Task } from "../types.js";

/**
 * Reject the attempt unless the changed tests FAIL when the source is reverted to
 * `base`. It's a one-mutant mutation test with a free, realistic mutant — the old
 * code. If the updated tests also pass on the old source, they don't actually
 * check the intended change (e.g. a worker loosened `toBe("$19.99")` to
 * `toBeTruthy()`), so the gate fails.
 *
 * How it works without touching the task's own worktree:
 *   1. add a throwaway worktree at HEAD (the committed intentional change)
 *   2. revert `srcGlob` to `base` there, so the source behaves the old way
 *   3. copy the worker's changed (test) files over the top
 *   4. run the test command; a non-zero exit means the tests caught the change
 *   5. remove the throwaway worktree
 *
 * The throwaway worktree is created inside the task worktree so it resolves
 * `node_modules` upward the same way the task worktree does — no symlink needed.
 *
 * `base`, `test` and (effectively) the file list come from the task, mirroring
 * `commandPasses`/`onlyTouches`: `base` is the commit before the change, `srcGlob`
 * the source to revert (a git pathspec, e.g. `"src"`), and `test` the command.
 */
export function failsOnBase(
  base: (task: Task) => string,
  srcGlob: string,
  test: (task: Task) => string,
  opts: { timeoutMs?: number } = {},
): Gate {
  // git checkout takes a pathspec, not a glob: "src/**" wouldn't match "src/a.ts"
  // the way a shell glob does, while "src" restores the whole directory.
  const pathspec = srcGlob.replace(/\/\*+$/, "");

  return {
    name: "failsOnBase",
    async check(ctx) {
      const baseRef = base(ctx.task);
      const testCmd = test(ctx.task);
      const tmp = path.join(ctx.worktree, `.orca-base-${randomUUID().slice(0, 8)}`);

      try {
        const add = await ctx.exec(`git worktree add --detach ${tmp} HEAD`);
        if (add.code !== 0) {
          return fail(`could not create a base worktree: ${tail(add)}`);
        }

        const checkout = await ctx.exec(`git -C ${tmp} checkout ${baseRef} -- ${pathspec}`);
        if (checkout.code !== 0) {
          return fail(`could not revert ${pathspec} to ${baseRef}: ${tail(checkout)}`);
        }

        // Overlay the worker's changed files (only test files reach here, since the
        // scope gate runs first) onto the old source.
        for (const file of ctx.changedFiles) {
          const dest = path.join(tmp, file);
          await mkdir(path.dirname(dest), { recursive: true });
          await copyFile(path.join(ctx.worktree, file), dest);
        }

        const run = await ctx.exec(`cd ${tmp} && ${testCmd}`, { timeoutMs: opts.timeoutMs });
        if (run.code !== 0) return { ok: true }; // tests caught the change: good

        return fail(
          "the updated tests still pass with the source reverted to the old code, " +
            "so they don't check the intended change",
        );
      } finally {
        await ctx.exec(`git worktree remove --force ${tmp}`).catch(() => {});
        await rm(tmp, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

function fail(reason: string) {
  return { ok: false as const, reasons: [reason] };
}

function tail({ stdout, stderr }: { stdout: string; stderr: string }): string {
  return `${stderr}${stdout}`.trim().split("\n").slice(-20).join("\n");
}
