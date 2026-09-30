// Shared by every backend that reads Claude's stream-json lines (real CLI and FakeMessenger).
import { parseJsonLines } from "./jsonl.js";
import { createNormalizer } from "./normalize.js";
import type { DoneEvent, MessengerEvent } from "./types.js";

/**
 * Read stdout lines → parse → normalize → emit events.
 * Returns Claude's result as a DoneEvent (not emitted), so the caller's finalize() decides the real done.
 */
export async function pumpLines(
  lines: AsyncIterable<string>,
  emit: (e: MessengerEvent) => void,
  onLine?: (line: string) => void,
): Promise<DoneEvent | undefined> {
  const normalize = createNormalizer();
  let result: DoneEvent | undefined;

  for await (const parsed of parseJsonLines(lines, onLine)) {
    if (!parsed.ok) {
      emit({ type: "raw", msg: parsed.line }); // not JSON: pass it through, keep going
      continue;
    }
    for (const event of normalize(parsed.value)) {
      if (event.type === "done")
        result = event; // hold it
      else emit(event);
    }
  }
  return result;
}
