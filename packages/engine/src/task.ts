// The task loop (design §7): worker → gates → retry with feedback.
// Code decides whether the work counts; the worker never grades itself.

import { exec } from "./exec.js";
import { runGates } from "./gates/run.js";
import type { AnyRecipe, GateContext, RunCtx, Task, TaskResult } from "./types.js";
import { createWorktree, getDiff, removeWorktree } from "./workspace.js";

/** Prepend the previous attempt's rejection reasons to the prompt, verbatim. */
function withFeedback(prompt: string, feedback: string[]): string {
  if (feedback.length === 0) return prompt;
  const list = feedback.map((r) => `- ${r}`).join("\n");
  return `${prompt}\n\nYour previous attempt was rejected. Fix these problems and try again:\n${list}`;
}

export async function runTask(task: Task, recipe: AnyRecipe, ctx: RunCtx): Promise<TaskResult> {
  let feedback: string[] = [];
  let costUsd = 0;
  let lastWorktree = "";

  for (let attempt = 1; attempt <= ctx.limits.maxAttempts; attempt++) {
    const worktree = await createWorktree(ctx.repo, ctx.runId, task.id, attempt);
    lastWorktree = worktree.path;
    ctx.emit({ type: "task.started", taskId: task.id, attempt, worktree: worktree.path });

    const cfg = recipe.worker(task, ctx);
    const run = ctx.messenger.send({
      prompt: withFeedback(cfg.prompt, feedback),
      cwd: worktree.path,
      tools: cfg.tools,
      maxTurns: cfg.maxTurns,
      model: cfg.model,
      system: cfg.system,
      signal: ctx.signal,
    });
    for await (const event of run.events) {
      ctx.emit({ type: "worker.event", taskId: task.id, event });
    }
    const done = await run.done;
    costUsd += done.costUsd ?? 0;

    const diff = await getDiff(worktree.path);

    // A worker that errored out is a failure reason on its own — skip the gates.
    let reasons: string[];
    if (done.ok) {
      const gctx: GateContext = {
        worktree: worktree.path,
        task,
        diff: diff.patch,
        changedFiles: diff.files,
        exec: (cmd, opts) => exec(worktree.path, cmd, opts),
      };
      reasons = await runGates(recipe.gates, gctx, ctx, task.id);
    } else {
      reasons = [`worker failed: ${done.error?.kind ?? "unknown"}: ${done.error?.message ?? ""}`];
    }

    if (reasons.length === 0) {
      ctx.emit({ type: "task.done", taskId: task.id, attempts: attempt, costUsd });
      return {
        task,
        ok: true,
        attempts: attempt,
        costUsd,
        diff: diff.patch,
        worktree: worktree.path,
      };
    }

    feedback = reasons;
    if (attempt < ctx.limits.maxAttempts) {
      ctx.emit({ type: "task.retrying", taskId: task.id, attempt, reasons });
      await removeWorktree(ctx.repo, worktree.path); // discard between attempts; keep the last one
    }
  }

  await recipe.onFailed?.(task, feedback, ctx);
  ctx.emit({ type: "task.failed", taskId: task.id, reasons: feedback });
  return {
    task,
    ok: false,
    attempts: ctx.limits.maxAttempts,
    costUsd,
    failures: feedback,
    worktree: lastWorktree,
  };
}
