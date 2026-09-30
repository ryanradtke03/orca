import { describe, expect, it } from "vitest";
import { finalize } from "../src/backends/cli/finalize.js";
import type { ExitInfo } from "../src/backends/cli/spawn.js";
import type { DoneEvent } from "../src/types.js";

const exit = (over: Partial<ExitInfo> = {}): ExitInfo => ({
  code: 0,
  signal: null,
  stderr: "",
  timedOut: false,
  aborted: false,
  ...over,
});
const ok: DoneEvent = {
  type: "done",
  ok: true,
  text: "hi",
  sessionId: "s",
  costUsd: 0.01,
  turns: 1,
};
const enoent = Object.assign(new Error("spawn claude ENOENT"), {
  code: "ENOENT",
});

describe("finalize", () => {
  it.each([
    ["clean success", ok, exit(), undefined],
    [
      "binary missing",
      undefined,
      exit({ code: null, spawnError: enoent }),
      "not_found",
    ],
    ["cancelled", undefined, exit({ code: null, aborted: true }), "aborted"],
    ["timed out", undefined, exit({ code: null, timedOut: true }), "timeout"],
    [
      "aborted wins over timed out",
      undefined,
      exit({ aborted: true, timedOut: true }),
      "aborted",
    ],
    [
      "no result line",
      undefined,
      exit({ code: 1, stderr: "boom" }),
      "no_result",
    ],
    ["result but non-zero exit", ok, exit({ code: 2 }), "exit_code"],
  ] as const)("%s", (_label, result, info, kind) => {
    const done = finalize(result, info, 1000);
    expect(done.ok).toBe(kind === undefined);
    expect(done.error?.kind).toBe(kind);
  });

  it("keeps text and sessionId from the result when it fails", () => {
    const done = finalize(ok, exit({ timedOut: true }), 1000);
    expect(done).toMatchObject({
      ok: false,
      text: "hi",
      sessionId: "s",
      error: { kind: "timeout" },
    });
  });

  it("uses the stderr tail as the no_result message", () => {
    const done = finalize(
      undefined,
      exit({ code: 1, stderr: "x".repeat(5000) + "real error" }),
    );
    expect(done.error?.message.endsWith("real error")).toBe(true);
    expect(done.error?.message.length).toBeLessThanOrEqual(2000);
  });
});
