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
  let lastOutput = "";

  let attemptsRun = 0;
  for (let attempt = 1; attempt <= ctx.limits.maxAttempts; attempt++) {
    // Stop retrying if the run was cancelled or ran out of budget mid-task.
    if (ctx.signal.aborted || ctx.budget.exceeded()) break;

    attemptsRun = attempt;

    const worktree = await createWorktree(ctx.repo, ctx.runId, task.id, attempt, {
      base: ctx.base,
      worktreeDir: ctx.worktreeDir,
    });
    lastWorktree = worktree.path;
    ctx.emit({
      type: "task.started",
      taskId: task.id,
      attempt,
      worktree: worktree.path,
    });

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
    ctx.budget.add(done.costUsd ?? 0);
    lastOutput = done.text ?? "";

    const diff = await getDiff(worktree.path);

    // A worker that errored out is a failure reason on its own — skip the gates.
    let reasons: string[];
    if (done.ok) {
      const gctx: GateContext = {
        worktree: worktree.path,
        task,
        diff: diff.patch,
        changedFiles: diff.files,
        output: lastOutput,
        exec: (cmd, opts) => exec(worktree.path, cmd, opts),
      };
      reasons = await runGates(recipe.gates, gctx, ctx, task.id);
    } else {
      reasons = [`worker failed: ${done.error?.kind ?? "unknown"}: ${done.error?.message ?? ""}`];
    }

    if (reasons.length === 0) {
      ctx.emit({
        type: "task.done",
        taskId: task.id,
        attempts: attempt,
        costUsd,
      });
      return {
        task,
        ok: true,
        attempts: attempt,
        costUsd,
        diff: diff.patch,
        output: lastOutput,
        worktree: worktree.path,
      };
    }

    feedback = reasons;
    const willRetry =
      attempt < ctx.limits.maxAttempts && !ctx.signal.aborted && !ctx.budget.exceeded();
    if (!willRetry) break;
    ctx.emit({ type: "task.retrying", taskId: task.id, attempt, reasons });
    await removeWorktree(ctx.repo, worktree.path);
  }

  await recipe.onFailed?.(task, feedback, ctx);
  ctx.emit({ type: "task.failed", taskId: task.id, reasons: feedback });
  return {
    task,
    ok: false,
    attempts: attemptsRun,
    costUsd,
    output: lastOutput,
    failures: feedback,
    worktree: lastWorktree,
  };
}
