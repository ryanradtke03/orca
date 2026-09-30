// The top-level flow (design §6). Phase 1: plan → run tasks one after another → finish.
// Validation, approval, scheduling, budgets and cancel arrive in later phases.
import { runTask } from "./task.js";
import type { AnyRecipe, RunCtx, RunResult, TaskResult } from "./types.js";

export async function runRecipe(
  recipe: AnyRecipe,
  input: unknown,
  ctx: RunCtx,
): Promise<RunResult> {
  const startedAt = Date.now();
  ctx.emit({ type: "run.started", recipe: recipe.name, input });

  const tasks = await recipe.plan(input, ctx);

  const results: TaskResult[] = [];
  for (const task of tasks) {
    results.push(await runTask(task, recipe, ctx));
  }

  const output = await recipe.finish(results, ctx);
  const ok = results.length > 0 && results.every((r) => r.ok);
  const costUsd = results.reduce((sum, r) => sum + r.costUsd, 0);

  return {
    ok,
    status: ok ? "completed" : "partial",
    output,
    tasks: results.map((r) => ({
      id: r.task.id,
      ok: r.ok,
      attempts: r.attempts,
      costUsd: r.costUsd,
      diff: r.diff,
      failures: r.failures,
    })),
    costUsd,
    durationMs: Date.now() - startedAt,
    tracePath: "",
  };
}
