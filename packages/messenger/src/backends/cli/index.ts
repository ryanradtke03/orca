import { pumpLines } from "../../pipeline.js";
import { createRun } from "../../run.js";
import { openTrace } from "../../trace.js";
import type {
  CliMessengerOptions,
  Messenger,
  MessengerRequest,
  MessengerRun,
} from "../../types.js";
import { validateRequest } from "../../validate.js";
import { buildArgs } from "./args.js";
import { buildEnv } from "./env.js";
import { finalize } from "./finalize.js";
import { spawnClaude } from "./spawn.js";

const FIVE_MINUTES = 5 * 60_000;

export class CliMessenger implements Messenger {
  constructor(private readonly opts: CliMessengerOptions = {}) {}

  send(req: MessengerRequest): MessengerRun {
    return createRun(async (emit) => {
      const v = validateRequest(req, {
        timeoutMs: this.opts.defaultTimeoutMs ?? FIVE_MINUTES,
        model: this.opts.defaultModel,
      });
      if (!v.ok) {
        return {
          type: "done",
          ok: false,
          error: { kind: "invalid_request", message: v.error },
        };
      }
      const r = v.value;
      const args = buildArgs(r, { strictMcp: this.opts.strictMcp ?? true });
      const startedAt = Date.now();
      const trace = this.opts.traceDir
        ? await openTrace(this.opts.traceDir)
        : undefined;

      const proc = spawnClaude(this.opts.claudePath ?? "claude", args, {
        cwd: r.cwd,
        env: buildEnv(this.opts),
        timeoutMs: r.timeoutMs,
        signal: r.signal,
      });

      const result = await pumpLines(proc.lines, emit, trace?.write);
      const exit = await proc.exit;
      const done = finalize(result, exit, r.timeoutMs);

      if (trace) {
        const { signal: _signal, ...request } = r; // AbortSignal isn't JSON
        await trace.close({
          request,
          args,
          done,
          exit: {
            code: exit.code,
            signal: exit.signal,
            timedOut: exit.timedOut,
            aborted: exit.aborted,
          },
          stderrTail: exit.stderr.slice(-2000),
          startedAt: new Date(startedAt).toISOString(),
          durationMs: Date.now() - startedAt,
        });
        return { ...done, tracePath: trace.path };
      }
      return done;
    });
  }
}
