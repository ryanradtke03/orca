// Runs a plan's tasks in dependency order, up to maxWorkers at a time.
// A task runs once all its dependencies have succeeded; if any dependency
// failed or was skipped, the task is skipped (and so are its dependents).
import type { Budget, EngineEvent, Task, TaskResult } from "./types.js";

/**
 * Validate the task graph before running anything: unique ids, every dependency
 * referring to a real task, and no cycles. Returns an error message, or null.
 */
export function validateGraph(tasks: Task[]): string | null {
  const byId = new Map<string, Task>();
  for (const t of tasks) {
    if (byId.has(t.id)) return `duplicate task id "${t.id}" in plan`;
    byId.set(t.id, t);
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!byId.has(dep)) return `task "${t.id}" depends on unknown task "${dep}"`;
    }
  }

  // DFS cycle detection: 0 = unvisited, 1 = on the current path, 2 = done.
  const mark = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const visit = (id: string): string | null => {
    mark.set(id, 1);
    path.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      const m = mark.get(dep) ?? 0;
      if (m === 1) {
        const from = path.indexOf(dep);
        return `dependency cycle: ${[...path.slice(from), dep].join(" -> ")}`;
      }
      if (m === 0) {
        const cycle = visit(dep);
        if (cycle) return cycle;
      }
    }
    path.pop();
    mark.set(id, 2);
    return null;
  };
  for (const t of tasks) {
    if ((mark.get(t.id) ?? 0) === 0) {
      const cycle = visit(t.id);
      if (cycle) return cycle;
    }
  }
  return null;
}

type TaskState = "pending" | "running" | "done" | "failed" | "skipped";

export interface ScheduleCtx {
  limits: { maxWorkers: number };
  signal: { readonly aborted: boolean };
  budget: Budget;
  emit(event: EngineEvent): void;
}

export interface ScheduleResult {
  results: TaskResult[]; // in original plan order
  stopped: "cancelled" | "budget" | "timeout" | null;
}

/**
 * Drive the tasks to completion. `runOne` is the per-task worker (runTask in
 * production, a fake in tests) — the scheduler only cares about the result's `ok`.
 */
export async function schedule(
  tasks: Task[],
  runOne: (task: Task) => Promise<TaskResult>,
  ctx: ScheduleCtx,
): Promise<ScheduleResult> {
  const state = new Map<string, TaskState>(tasks.map((t) => [t.id, "pending"]));
  const results = new Map<string, TaskResult>();
  const inflight = new Map<string, Promise<void>>();
  let stopped: ScheduleResult["stopped"] = null;

  const isDone = (id: string) => state.get(id) === "done";
  const isBlocked = (task: Task) =>
    task.dependsOn.some((d) => state.get(d) === "failed" || state.get(d) === "skipped");
  const depsReady = (task: Task) => task.dependsOn.every(isDone);
  const terminal = (s: TaskState | undefined) => s === "done" || s === "failed" || s === "skipped";

  while (true) {
    if (ctx.signal.aborted) {
      stopped = "cancelled";
      break;
    }
    const cap = ctx.budget.exceeded();
    if (cap) {
      stopped = cap;
      break;
    }

    // Mark newly-blocked tasks as skipped, and launch ready tasks up to the cap.
    for (const task of tasks) {
      if (state.get(task.id) !== "pending") continue;

      if (isBlocked(task)) {
        const bad = task.dependsOn.filter(
          (d) => state.get(d) === "failed" || state.get(d) === "skipped",
        );
        const reason = `skipped: dependency ${bad.join(", ")} did not succeed`;
        state.set(task.id, "skipped");
        results.set(task.id, { task, ok: false, attempts: 0, costUsd: 0, failures: [reason] });
        ctx.emit({ type: "task.skipped", taskId: task.id, reason });
        continue;
      }

      if (depsReady(task) && inflight.size < ctx.limits.maxWorkers) {
        state.set(task.id, "running");
        const p = (async () => {
          const r = await runOne(task);
          results.set(task.id, r);
          state.set(task.id, r.ok ? "done" : "failed");
        })().finally(() => {
          inflight.delete(task.id);
        });
        inflight.set(task.id, p);
      }
    }

    if (tasks.every((t) => terminal(state.get(t.id))) && inflight.size === 0) break;

    // Nothing running and nothing launchable — shouldn't happen after validateGraph.
    if (inflight.size === 0) break;

    await Promise.race(inflight.values());
  }

  // On an early stop, let in-flight tasks settle so results/worktrees are consistent.
  if (stopped) await Promise.allSettled(inflight.values());

  const ordered = tasks
    .map((t) => results.get(t.id))
    .filter((r): r is TaskResult => r !== undefined);
  return { results: ordered, stopped };
}
