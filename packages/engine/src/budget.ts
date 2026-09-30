// Tracks a run's cost and elapsed time against the limits. Emits budget.warning
// once at 80% of each cap; exceeded() reports which cap (if any) has been hit.
import type { Budget, EngineEvent, EngineLimits } from "./types.js";

const WARN_AT = 0.8;

export function createBudget(limits: EngineLimits, emit: (e: EngineEvent) => void): Budget {
  const startedAt = Date.now();
  let cost = 0;
  let costWarned = false;
  let durationWarned = false;

  const elapsed = () => Date.now() - startedAt;

  function maybeWarnDuration(): void {
    if (!durationWarned && elapsed() >= limits.maxDurationMs * WARN_AT) {
      durationWarned = true;
      emit({
        type: "budget.warning",
        resource: "duration",
        used: elapsed(),
        limit: limits.maxDurationMs,
      });
    }
  }

  return {
    add(costUsd) {
      cost += costUsd;
      if (!costWarned && cost >= limits.maxCostUsd * WARN_AT) {
        costWarned = true;
        emit({ type: "budget.warning", resource: "cost", used: cost, limit: limits.maxCostUsd });
      }
    },
    costUsed: () => cost,
    elapsedMs: elapsed,
    exceeded() {
      maybeWarnDuration();
      if (cost >= limits.maxCostUsd) return "budget";
      if (elapsed() >= limits.maxDurationMs) return "timeout";
      return null;
    },
  };
}
