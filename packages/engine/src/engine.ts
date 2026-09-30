import { createBudget } from "./budget.js";
import { runRecipe } from "./lifecycle.js";
import { createEngineRun } from "./run.js";
import type {
  Engine,
  EngineConfig,
  EngineLimits,
  KeepWorktrees,
  RunCtx,
  RunResult,
  StartOptions,
} from "./types.js";

const DEFAULT_LIMITS: EngineLimits = {
  maxWorkers: 2,
  maxAttempts: 3,
  maxCostUsd: 3,
  maxDurationMs: 30 * 60 * 1000, // 30 minutes
};

function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 8);
  return `run-${stamp}-${rand}`;
}

export function createEngine(config: EngineConfig): Engine {
  const baseLimits: EngineLimits = { ...DEFAULT_LIMITS, ...config.limits };
  const keepWorktrees: KeepWorktrees = config.keepWorktrees ?? "on-failure";

  return {
    start(name, input, opts?: StartOptions) {
      const id = newRunId();
      const limits: EngineLimits = { ...baseLimits, ...opts?.limits };
      const recipe = config.recipes[name];

      const run = createEngineRun(id, async (emit, signal, waitApproval): Promise<RunResult> => {
        const ctx: RunCtx = {
          repo: config.repo,
          messenger: config.messenger,
          signal,
          emit,
          runId: id,
          limits,
          budget: createBudget(limits, emit),
          keepWorktrees,
          worktreeDir: config.worktreeDir,
          approvePlan: opts?.approvePlan ?? false,
          waitApproval,
        };
        return runRecipe(recipe, name, input, ctx);
      });

      // Let a caller-supplied signal cancel the run too.
      if (opts?.signal) {
        if (opts.signal.aborted) run.cancel();
        else opts.signal.addEventListener("abort", () => run.cancel(), { once: true });
      }

      return run;
    },
  };
}
