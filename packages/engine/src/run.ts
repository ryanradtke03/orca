import { createQueue } from "./queue.js";
import type { EngineEvent, EngineRun, RunResult } from "./types.js";

/**
 * Given a run id and a producer, wire up an EngineRun. Same pattern as the
 * messenger's createRun: the producer starts immediately, and `done` always
 * resolves — a thrown producer becomes a `failed` RunResult, never a rejection.
 */
export function createEngineRun(
  id: string,
  producer: (emit: (e: EngineEvent) => void, signal: AbortSignal) => Promise<RunResult>,
): EngineRun {
  const queue = createQueue<EngineEvent>();
  const controller = new AbortController();

  const done: Promise<RunResult> = producer((e) => queue.push(e), controller.signal)
    .catch(
      (err): RunResult => ({
        ok: false,
        status: "failed",
        tasks: [],
        costUsd: 0,
        durationMs: 0,
        tracePath: "",
        error: {
          kind: "plan_failed",
          message: err instanceof Error ? err.message : String(err),
        },
      }),
    )
    .then((result) => {
      queue.push({ type: "run.done", result }); // run.done lands on the stream exactly once...
      queue.close(); // ...then the stream ends
      return result;
    });

  return {
    id,
    events: queue,
    done,
    cancel() {
      controller.abort();
    },
    // Answering an approval prompt is wired up in Phase 4.
    approve(_ok: boolean) {},
  };
}
