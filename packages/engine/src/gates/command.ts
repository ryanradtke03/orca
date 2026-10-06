import type { Gate, Task } from "../types.js";

/**
 * The command must exit 0 in the worktree. On failure, the tail of its output
 * becomes the reason, so the next attempt sees the actual errors.
 *
 * `command` may be a string, or a function of the task (fix-ci reads it from
 * task.context so the same recipe works for any command).
 */
export function commandPasses(
  command: string | ((task: Task) => string),
  opts: { timeoutMs?: number; tailLines?: number } = {},
): Gate {
  const tailLines = opts.tailLines ?? 20;

  return {
    name: "commandPasses",
    async check(ctx) {
      const cmd = typeof command === "function" ? command(ctx.task) : command;
      const { code, stdout, stderr } = await ctx.exec(cmd, { timeoutMs: opts.timeoutMs });
      if (code === 0) return { ok: true };

      const output = `${stderr}${stdout}`.trim();
      const tail = output.split("\n").slice(-tailLines).join("\n");
      const detail = tail ? `:\n${tail}` : "";
      return { ok: false, reasons: [`\`${cmd}\` exited with ${code}${detail}`] };
    },
  };
}

/**
 * The inverse of `commandPasses`: the command must exit non-zero in the worktree.
 * repro-bug uses it to require that the new test *fails* on the current code — a
 * test that passes wouldn't show the reported bug.
 *
 * `command` may be a string or a function of the task, the same as `commandPasses`.
 */
export function commandFails(command: string | ((task: Task) => string)): Gate {
  return {
    name: "commandFails",
    async check(ctx) {
      const cmd = typeof command === "function" ? command(ctx.task) : command;
      const { code } = await ctx.exec(cmd);
      if (code !== 0) return { ok: true };
      return {
        ok: false,
        reasons: [`\`${cmd}\` passed; the test doesn't reproduce the bug`],
      };
    },
  };
}
