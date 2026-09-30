import { createQueue } from "./queue.js";
import type { EngineEvent, EngineRun, RunResult } from "./types.js";

/**
 * Given a run id and a producer, wire up an EngineRun. Same pattern as the
 * messenger's createRun: the producer starts immediately, and `done` always
 * resolves — a thrown producer becomes a `failed` RunResult, never a rejection.
 *
 * The producer also gets `waitApproval()`, resolved by `run.approve(ok)` (or
 * `false` on cancel), so a recipe can pause for plan approval.
 */
export function createEngineRun(
  id: string,
  producer: (
    emit: (e: EngineEvent) => void,
    signal: AbortSignal,
    waitApproval: () => Promise<boolean>,
  ) => Promise<RunResult>,
): EngineRun {
  const queue = createQueue<EngineEvent>();
  const controller = new AbortController();

  // Approval plumbing: waitApproval() resolves once approve()/cancel() is called.
  let settle: ((ok: boolean) => void) | null = null;
  let decided: boolean | null = null;
  const waitApproval = (): Promise<boolean> => {
    if (decided !== null) return Promise.resolve(decided);
    return new Promise<boolean>((resolve) => {
      settle = resolve;
    });
  };
  const decide = (ok: boolean) => {
    decided = ok;
    if (settle) {
      settle(ok);
      settle = null;
    }
  };

  const done: Promise<RunResult> = producer((e) => queue.push(e), controller.signal, waitApproval)
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
      decide(false); // unblock a pending approval so the run can wind down
    },
    approve(ok: boolean) {
      decide(ok);
    },
  };
}
