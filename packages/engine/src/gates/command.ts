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
