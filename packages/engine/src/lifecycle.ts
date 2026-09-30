// The top-level flow (design §6): validate → plan → run tasks → finish, with
// every exit producing a clean RunResult. Scheduling/parallelism is Phase 4;
// tasks still run one after another here.
import { runTask } from "./task.js";
import type {
  AnyRecipe,
  RunCtx,
  RunErrorKind,
  RunResult,
  RunResultTask,
  TaskResult,
} from "./types.js";
import { ensureExcluded, pruneWorktrees, removeRunWorktrees, removeWorktree } from "./workspace.js";

function summarize(results: TaskResult[]): RunResultTask[] {
  return results.map((r) => ({
    id: r.task.id,
    ok: r.ok,
    attempts: r.attempts,
    costUsd: r.costUsd,
    diff: r.diff,
    failures: r.failures,
  }));
}

function zodMessage(err: unknown): string {
  const issues = (err as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
  if (!issues || issues.length === 0) return "invalid input";
  return issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Remove worktrees according to the keepWorktrees policy (everything, on cancel). */
async function cleanupWorktrees(
  ctx: RunCtx,
  results: TaskResult[],
  cancelled: boolean,
): Promise<void> {
  if (cancelled) {
    await removeRunWorktrees(ctx.repo, ctx.runId, ctx.worktreeDir);
    return;
  }
  if (ctx.keepWorktrees === "always") return;

  for (const r of results) {
    if (!r.worktree) continue;
    const drop = ctx.keepWorktrees === "never" || (ctx.keepWorktrees === "on-failure" && r.ok);
    if (drop) await removeWorktree(ctx.repo, r.worktree);
  }
  await pruneWorktrees(ctx.repo);
}

export async function runRecipe(
  recipe: AnyRecipe | undefined,
  name: string,
  input: unknown,
  ctx: RunCtx,
): Promise<RunResult> {
  const empty: Omit<RunResult, "ok" | "status"> = {
    tasks: [],
    costUsd: 0,
    durationMs: 0,
    tracePath: "",
  };
  const fail = (kind: RunErrorKind, message: string): RunResult => ({
    ...empty,
    ok: false,
    status: kind === "budget" || kind === "timeout" ? "partial" : "failed",
    durationMs: ctx.budget.elapsedMs(),
    error: { kind, message },
  });

  // 1. recipe must exist
  if (!recipe) return fail("unknown_recipe", `No recipe named "${name}"`);

  ctx.emit({ type: "run.started", recipe: recipe.name, input });

  // 2. input must satisfy the recipe's schema — nothing runs otherwise
  const parsed = recipe.input.safeParse(input);
  if (!parsed.success) return fail("invalid_input", zodMessage(parsed.error));

  await ensureExcluded(ctx.repo);

  // 3. plan
  let tasks: TaskResult["task"][];
  try {
    tasks = await recipe.plan(parsed.data, ctx);
  } catch (err) {
    return fail("plan_failed", toMessage(err));
  }
  if (!tasks || tasks.length === 0) return fail("plan_failed", "plan() returned no tasks");

  // 4. run tasks (sequentially for now), stopping on cancel or budget
  const results: TaskResult[] = [];
  let stopped: "cancelled" | "budget" | "timeout" | null = null;
  for (const task of tasks) {
    if (ctx.signal.aborted) {
      stopped = "cancelled";
      break;
    }
    const capped = ctx.budget.exceeded();
    if (capped) {
      stopped = capped;
      break;
    }
    results.push(await runTask(task, recipe, ctx));
    if (ctx.signal.aborted) {
      stopped = "cancelled";
      break;
    }
  }

  await cleanupWorktrees(ctx, results, stopped === "cancelled");

  const tally: Omit<RunResult, "ok" | "status" | "output" | "error"> = {
    tasks: summarize(results),
    costUsd: ctx.budget.costUsed(),
    durationMs: ctx.budget.elapsedMs(),
    tracePath: "",
  };

  // 5. short-circuit exits — no finish() on cancel or budget stop
  if (stopped === "cancelled") {
    return {
      ...tally,
      ok: false,
      status: "cancelled",
      error: { kind: "cancelled", message: "run cancelled" },
    };
  }
  if (stopped === "budget" || stopped === "timeout") {
    const message = stopped === "budget" ? "cost limit reached" : "duration limit reached";
    return { ...tally, ok: false, status: "partial", error: { kind: stopped, message } };
  }

  // 6. finish, then decide the final status from the task results
  let output: unknown;
  let finishFailed: string | null = null;
  try {
    output = await recipe.finish(results, ctx);
  } catch (err) {
    finishFailed = toMessage(err);
  }

  const allOk = results.every((r) => r.ok);
  const noneOk = results.every((r) => !r.ok);
  const status: RunResult["status"] = finishFailed
    ? "failed"
    : allOk
      ? "completed"
      : noneOk
        ? "failed"
        : "partial";

  return {
    ...tally,
    ok: status === "completed",
    status,
    output,
    ...(finishFailed ? { error: { kind: "finish_failed", message: finishFailed } } : {}),
  };
}
