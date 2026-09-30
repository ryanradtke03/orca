// Run every gate for one task attempt, collect all failure reasons, and emit
// gate.passed / gate.failed as they go. A gate that throws counts as a failure.
import type { Gate, GateContext, RunCtx } from "../types.js";

export async function runGates(
  gates: Gate[],
  gctx: GateContext,
  ctx: RunCtx,
  taskId: string,
): Promise<string[]> {
  const reasons: string[] = [];

  for (const gate of gates) {
    let result: { ok: true } | { ok: false; reasons: string[] };
    try {
      result = await gate.check(gctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { ok: false, reasons: [`${gate.name} threw: ${message}`] };
    }

    if (result.ok) {
      ctx.emit({ type: "gate.passed", taskId, gate: gate.name });
    } else {
      ctx.emit({ type: "gate.failed", taskId, gate: gate.name, reasons: result.reasons });
      reasons.push(...result.reasons);
    }
  }

  return reasons;
}
