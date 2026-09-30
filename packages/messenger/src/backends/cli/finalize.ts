import type { DoneEvent, MessengerErrorKind } from "../../types.js";
import type { ExitInfo } from "./spawn.js";

/**
 * Decide the one final DoneEvent from Claude's result line (if any) and how the process exited.
 * Pure function. Order matters: the most specific reason wins.
 */
export function finalize(
  result: DoneEvent | undefined,
  exit: ExitInfo,
  timeoutMs?: number,
): DoneEvent {
  const fail = (kind: MessengerErrorKind, message: string): DoneEvent => ({
    ...(result ?? { type: "done" }), // keep text / sessionId / cost if Claude got that far
    type: "done",
    ok: false,
    error: { kind, message },
  });

  if (exit.spawnError) {
    return exit.spawnError.code === "ENOENT"
      ? fail(
          "not_found",
          "claude not found. Is it installed and on your PATH? (or set claudePath)",
        )
      : fail("spawn", exit.spawnError.message);
  }
  if (exit.aborted) {
    return fail("aborted", "Run was cancelled");
  }
  if (exit.timedOut) {
    return fail(
      "timeout",
      `Run took longer than ${timeoutMs !== undefined ? `${timeoutMs}ms` : "the timeout"} and was stopped`,
    );
  }
  if (!result) {
    const tail = exit.stderr.trim().slice(-2000);
    return fail(
      "no_result",
      tail || `claude exited with code ${exit.code} and no result`,
    );
  }
  if (exit.code !== 0 && result.ok) {
    return fail("exit_code", `claude exited with code ${exit.code}`);
  }
  return result;
}
