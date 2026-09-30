// Replays recorded Claude output through the exact same pipeline as the real CLI backend.
import { readFile } from "node:fs/promises";
import { pumpLines } from "../pipeline.js";
import { createRun } from "../run.js";
import type {
  FakeMessengerOptions,
  Fixture,
  Messenger,
  MessengerRequest,
  MessengerRun,
} from "../types.js";
import { validateRequest } from "../validate.js";
import { finalize } from "./cli/finalize.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function* fixtureLines(
  fixture: Fixture,
  delayMs: number,
  isAborted: () => boolean,
): AsyncGenerator<string> {
  const lines =
    typeof fixture === "string"
      ? (await readFile(fixture, "utf8")).split("\n")
      : fixture.map((obj) => JSON.stringify(obj));
  for (const line of lines) {
    if (isAborted()) return;
    if (delayMs > 0) await sleep(delayMs);
    yield line;
  }
}

export class FakeMessenger implements Messenger {
  /** Every request received, for assertions in tests. */
  readonly calls: MessengerRequest[] = [];

  constructor(private readonly opts: FakeMessengerOptions) {}

  send(req: MessengerRequest): MessengerRun {
    const callIndex = this.calls.length;
    this.calls.push(req);

    return createRun(async (emit) => {
      const v = validateRequest(req, { timeoutMs: 60_000, model: undefined }); // same rules as the real one
      if (!v.ok)
        return {
          type: "done",
          ok: false,
          error: { kind: "invalid_request", message: v.error },
        };

      const { fixtures } = this.opts;
      const fixture =
        typeof fixtures === "function"
          ? fixtures(req, callIndex)
          : fixtures[callIndex];
      if (fixture === undefined) {
        return {
          type: "done",
          ok: false,
          error: {
            kind: "no_result",
            message: `FakeMessenger has no fixture for call #${callIndex + 1}`,
          },
        };
      }

      const isAborted = () => req.signal?.aborted === true;
      const result = await pumpLines(
        fixtureLines(fixture, this.opts.delayMs ?? 0, isAborted),
        emit,
      );
      return finalize(result, {
        code: this.opts.exitCode ?? 0,
        signal: null,
        stderr: "",
        timedOut: false,
        aborted: isAborted(),
      });
    });
  }
}
