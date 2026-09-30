import { runRecipe } from "./lifecycle.js";
import { createEngineRun } from "./run.js";
import type {
  Engine,
  EngineConfig,
  EngineLimits,
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

  return {
    start(name, input, opts?: StartOptions) {
      const id = newRunId();
      const limits: EngineLimits = { ...baseLimits, ...opts?.limits };
      const recipe = config.recipes[name];

      return createEngineRun(id, async (emit, signal): Promise<RunResult> => {
        if (!recipe) {
          return {
            ok: false,
            status: "failed",
            tasks: [],
            costUsd: 0,
            durationMs: 0,
            tracePath: "",
            error: { kind: "unknown_recipe", message: `No recipe named "${name}"` },
          };
        }

        const ctx: RunCtx = {
          repo: config.repo,
          messenger: config.messenger,
          signal,
          emit,
          runId: id,
          limits,
        };
        return runRecipe(recipe, input, ctx);
      });
    },
  };
}
