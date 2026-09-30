import { createQueue } from "./queue.js";
import type { DoneEvent, MessengerEvent, MessengerRun } from "./types.js";

export type Producer = (
  emit: (e: MessengerEvent) => void,
) => Promise<DoneEvent>;

export function createRun(producer: Producer): MessengerRun {
  const queue = createQueue<MessengerEvent>();

  // Starts immediately: done resolves even if nobody reads events.
  const done: Promise<DoneEvent> = producer((e) => queue.push(e))
    .catch(
      (err): DoneEvent => ({
        type: "done",
        ok: false,
        error: {
          kind: "spawn",
          message: err instanceof Error ? err.message : String(err),
        },
      }),
    )
    .then((d) => {
      queue.push(d); // done lands on the stream exactly once...
      queue.close(); // ...then the stream ends
      return d;
    });

  return { events: queue, done };
}
