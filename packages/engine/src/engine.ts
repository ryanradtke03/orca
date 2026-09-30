import { z } from "zod";
import { createBudget } from "./budget.js";
import { runRecipe } from "./lifecycle.js";
import { createEngineRun } from "./run.js";
import { createTracer, readRuns } from "./trace.js";
import type {
  Engine,
  EngineConfig,
  EngineEvent,
  EngineLimits,
  EngineRun,
  KeepWorktrees,
  RecipeInfo,
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

function toJsonSchema(schema: z.ZodType): unknown {
  try {
    return z.toJSONSchema(schema);
  } catch {
    return {}; // a schema Zod can't serialize just gets an empty schema
  }
}

export function createEngine(config: EngineConfig): Engine {
  const baseLimits: EngineLimits = { ...DEFAULT_LIMITS, ...config.limits };
  const keepWorktrees: KeepWorktrees = config.keepWorktrees ?? "on-failure";
  const live = new Map<string, EngineRun>(); // runs still in progress, for get()

  return {
    start(name, input, opts?: StartOptions) {
      const id = newRunId();
      const limits: EngineLimits = { ...baseLimits, ...opts?.limits };
      const recipe = config.recipes[name];

      const run = createEngineRun(id, async (emit, signal, waitApproval): Promise<RunResult> => {
        const tracer = config.traceDir ? createTracer(config.traceDir, id) : null;
        const tracedEmit: (e: EngineEvent) => void = tracer
          ? (e) => {
              tracer.event(e);
              emit(e);
            }
          : emit;

        const ctx: RunCtx = {
          repo: config.repo,
          messenger: config.messenger,
          signal,
          emit: tracedEmit,
          runId: id,
          limits,
          budget: createBudget(limits, tracedEmit),
          keepWorktrees,
          worktreeDir: config.worktreeDir,
          approvePlan: opts?.approvePlan ?? false,
          waitApproval,
        };

        const result = await runRecipe(recipe, name, input, ctx);
        if (!tracer) return result;

        const withPath: RunResult = { ...result, tracePath: tracer.path };
        tracer.event({ type: "run.done", result: withPath });
        await tracer.finish(withPath);
        return withPath;
      });

      live.set(id, run);
      run.done.finally(() => live.delete(id));

      // Let a caller-supplied signal cancel the run too.
      if (opts?.signal) {
        if (opts.signal.aborted) run.cancel();
        else opts.signal.addEventListener("abort", () => run.cancel(), { once: true });
      }

      return run;
    },

    recipes(): RecipeInfo[] {
      return Object.entries(config.recipes).map(([name, recipe]) => ({
        name: recipe.name || name,
        description: recipe.description,
        inputSchema: toJsonSchema(recipe.input),
      }));
    },

    runs() {
      return config.traceDir ? readRuns(config.traceDir) : Promise.resolve([]);
    },

    get(runId) {
      return live.get(runId);
    },
  };
}
