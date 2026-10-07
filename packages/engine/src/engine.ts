import { z } from "zod";
import { createBudget } from "./budget.js";
import { isChain, makeStep, runChain } from "./chain.js";
import { exec } from "./exec.js";
import { createGitHelpers } from "./git.js";
import { runRecipe } from "./lifecycle.js";
import { createEngineRun } from "./run.js";
import { createTracer, readRuns } from "./trace.js";
import type {
  Budget,
  ChildRun,
  Engine,
  EngineConfig,
  EngineEvent,
  EngineLimits,
  EngineRun,
  KeepWorktrees,
  PrSink,
  RecipeInfo,
  Registered,
  RunCtx,
  RunResult,
  StartOptions,
} from "./types.js";
import { createBaseWorktree, removeWorktree } from "./workspace.js";

const DEFAULT_LIMITS: EngineLimits = {
  maxWorkers: 2,
  maxAttempts: 3,
  maxCostUsd: 3,
  maxDurationMs: 30 * 60 * 1000, // 30 minutes
};

const MAX_DEPTH = 3; // a chain can't recurse into child runs forever

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

/** A sink that fails clearly when a chain needs one but the engine wasn't given it. */
function noPrSink(): PrSink {
  const no = () => Promise.reject(new Error("no PR sink configured on the engine"));
  return { readIssue: no, open: no, comment: no };
}

/**
 * A child's budget: cost flows into the parent (so the chain's total is enforced
 * and reported), while an optional tighter cap limits just the child's own spend.
 * Time is the parent's — exceeded() defers to the parent first.
 */
function childBudget(parent: Budget, cap: number | undefined): Budget {
  let childCost = 0;
  return {
    add(costUsd) {
      childCost += costUsd;
      parent.add(costUsd);
    },
    costUsed: () => childCost,
    elapsedMs: () => parent.elapsedMs(),
    exceeded() {
      const hit = parent.exceeded();
      if (hit) return hit;
      if (cap !== undefined && childCost >= cap) return "budget";
      return null;
    },
  };
}

export function createEngine(config: EngineConfig): Engine {
  const baseLimits: EngineLimits = { ...DEFAULT_LIMITS, ...config.limits };
  const keepWorktrees: KeepWorktrees = config.keepWorktrees ?? "on-failure";
  const pr = config.pr ?? noPrSink();
  const live = new Map<string, EngineRun>(); // runs still in progress, for get()

  const execInRepo = (cwd: string) => (cmd: string, opts?: { timeoutMs?: number | undefined }) =>
    exec(cwd, cmd, opts).then((r) => ({ code: r.code, output: `${r.stdout}${r.stderr}` }));

  interface RunParams {
    id: string;
    entry: Registered | undefined;
    name: string;
    input: unknown;
    base: string;
    depth: number;
    signal: AbortSignal;
    emit: (e: EngineEvent) => void;
    waitApproval: () => Promise<boolean>;
    approvePlan: boolean;
    limits: EngineLimits;
    budget?: Budget | undefined; // children pass a shared/derived budget
  }

  /** Run one recipe or chain to completion, with its own trace and base worktree. */
  async function executeRun(p: RunParams): Promise<RunResult> {
    const tracer = config.traceDir ? createTracer(config.traceDir, p.id) : null;
    // run.done is written to the trace here (and, for the top-level run, pushed to
    // the public stream by createEngineRun); every other event goes to both.
    const emit: (e: EngineEvent) => void = tracer
      ? (e) => {
          tracer.event(e);
          p.emit(e);
        }
      : p.emit;

    const budget = p.budget ?? createBudget(p.limits, emit);

    // A base other than HEAD gets a read-only worktree so plan()'s ctx.exec (and
    // the task worktrees, cut from the same base) see the branch, not the checkout.
    const baseWorktree =
      p.base !== "HEAD"
        ? await createBaseWorktree(config.repo, p.id, p.base, config.worktreeDir)
        : null;

    const childRun: ChildRun = async (childName, childInput, childOpts) => {
      if (p.depth + 1 > MAX_DEPTH) {
        return {
          ok: false,
          status: "failed",
          tasks: [],
          costUsd: 0,
          durationMs: budget.elapsedMs(),
          tracePath: "",
          error: { kind: "plan_failed", message: `child run depth limit (${MAX_DEPTH}) reached` },
        };
      }
      const childId = newRunId();
      emit({ type: "child.started", childRunId: childId, recipe: childName });
      const result = await executeRun({
        id: childId,
        entry: config.recipes[childName],
        name: childName,
        input: childInput,
        base: childOpts?.base ?? "HEAD",
        depth: p.depth + 1,
        signal: p.signal,
        // forward the child's events to the parent, wrapped
        emit: (e) =>
          emit({ type: "child.event", childRunId: childId, recipe: childName, event: e }),
        waitApproval: () => Promise.resolve(true),
        approvePlan: false,
        limits: { ...p.limits, ...childOpts?.limits },
        budget: childBudget(budget, childOpts?.limits?.maxCostUsd),
      });
      emit({ type: "child.done", childRunId: childId, recipe: childName, result });
      return result;
    };

    const ctx: RunCtx = {
      repo: config.repo,
      messenger: config.messenger,
      signal: p.signal,
      emit,
      exec: execInRepo(baseWorktree ?? config.repo),
      runId: p.id,
      limits: p.limits,
      budget,
      keepWorktrees,
      worktreeDir: config.worktreeDir,
      base: p.base,
      depth: p.depth,
      approvePlan: p.approvePlan,
      waitApproval: p.waitApproval,
      run: childRun,
      git: createGitHelpers(config.repo),
      pr,
      step: makeStep({ emit, signal: p.signal }),
    };

    let result: RunResult;
    try {
      result = isChain(p.entry)
        ? await runChain(p.entry, p.name, p.input, ctx)
        : await runRecipe(p.entry, p.name, p.input, ctx);
    } finally {
      if (baseWorktree) await removeWorktree(config.repo, baseWorktree);
    }

    const withPath = tracer ? { ...result, tracePath: tracer.path } : result;
    if (tracer) {
      tracer.event({ type: "run.done", result: withPath });
      await tracer.finish(withPath);
    }
    return withPath;
  }

  return {
    start(name, input, opts?: StartOptions) {
      const id = newRunId();
      const limits: EngineLimits = { ...baseLimits, ...opts?.limits };

      const run = createEngineRun(id, (emit, signal, waitApproval) =>
        executeRun({
          id,
          entry: config.recipes[name],
          name,
          input,
          base: opts?.base ?? "HEAD",
          depth: 0,
          signal,
          emit,
          waitApproval,
          approvePlan: opts?.approvePlan ?? false,
          limits,
        }),
      );

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
      return Object.entries(config.recipes).map(([name, entry]) => ({
        name: entry.name || name,
        description: entry.description,
        inputSchema: toJsonSchema(entry.input),
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
