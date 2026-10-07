// Chains sequence child runs and deterministic steps. Unlike a recipe there's no
// plan/worker/gates — just code — so the lifecycle for a chain is thin: validate
// the input, run the function, and map its outcome to a RunResult. The chain's own
// detailed status (pr_opened, repro_only, …) travels in `output`.
import type { AnyChain, Chain, RunCtx, RunErrorKind, RunResult } from "./types.js";

/**
 * Thrown to unwind a chain when the run is cancelled (a child came back cancelled,
 * or the signal fired between steps). runChain turns it into a `cancelled` result,
 * so the chain's own code never has to thread cancellation through every branch.
 */
export class ChainAborted extends Error {
  constructor() {
    super("chain cancelled");
    this.name = "ChainAborted";
  }
}

/**
 * Typed chain authoring, mirroring defineRecipe: `run` sees the input inferred
 * from the Zod schema, with no manual generics at the call site.
 */
export function defineChain<I, O = unknown>(chain: Omit<Chain<I, O>, "kind">): Chain<I, O> {
  return { kind: "chain", ...chain };
}

export function isChain(entry: unknown): entry is AnyChain {
  return typeof entry === "object" && entry !== null && (entry as AnyChain).kind === "chain";
}

/** Wrap a ChainCtx's step() so step.started / step.done bracket each named step. */
export function makeStep(ctx: Pick<RunCtx, "emit" | "signal">) {
  return async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    if (ctx.signal.aborted) throw new ChainAborted();
    ctx.emit({ type: "step.started", name });
    try {
      return await fn();
    } finally {
      ctx.emit({ type: "step.done", name });
    }
  };
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A RunCtx is a superset of ChainCtx, so the engine passes the one it builds and
// runChain hands it straight to chain.run().
export async function runChain(
  chain: AnyChain,
  name: string,
  input: unknown,
  ctx: RunCtx,
): Promise<RunResult> {
  const base: Omit<RunResult, "ok" | "status"> = {
    tasks: [],
    costUsd: 0,
    durationMs: 0,
    tracePath: "",
  };
  const fail = (kind: RunErrorKind, message: string): RunResult => ({
    ...base,
    ok: false,
    status: kind === "budget" || kind === "timeout" ? "partial" : "failed",
    durationMs: ctx.budget.elapsedMs(),
    costUsd: ctx.budget.costUsed(),
    error: { kind, message },
  });
  const cancelled = (): RunResult => ({
    ...base,
    ok: false,
    status: "cancelled",
    durationMs: ctx.budget.elapsedMs(),
    costUsd: ctx.budget.costUsed(),
    error: { kind: "cancelled", message: "run cancelled" },
  });

  ctx.emit({ type: "run.started", recipe: chain.name || name, input });

  const parsed = chain.input.safeParse(input);
  if (!parsed.success) {
    const issues = (parsed.error as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    const message = issues?.length
      ? issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
      : "invalid input";
    return fail("invalid_input", message);
  }

  let output: unknown;
  try {
    output = await chain.run(parsed.data, ctx);
  } catch (err) {
    if (err instanceof ChainAborted || ctx.signal.aborted) return cancelled();
    return fail("plan_failed", toMessage(err));
  }

  // A cancel that landed between steps (no ChainAborted thrown) still wins.
  if (ctx.signal.aborted) return cancelled();

  return {
    ...base,
    ok: true,
    status: "completed",
    output,
    costUsd: ctx.budget.costUsed(),
    durationMs: ctx.budget.elapsedMs(),
  };
}
