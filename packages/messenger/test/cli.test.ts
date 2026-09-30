import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CliMessenger, collect } from "../src/index.js";
import { fakeBin } from "./helpers.js";

describe("CliMessenger", () => {
  it("runs a fake claude and returns its result", async () => {
    const m = new CliMessenger({ claudePath: fakeBin("fake-claude.mjs") });
    const { events, done } = await collect(m.send({ prompt: "hi" }));
    expect(events.some((e) => e.type === "message")).toBe(true);
    expect(done).toMatchObject({ ok: true, sessionId: "fake-1" });
  });

  it("reports not_found for a missing binary", async () => {
    const m = new CliMessenger({ claudePath: "definitely-not-claude" });
    expect((await m.send({ prompt: "hi" }).done).error?.kind).toBe("not_found");
  });

  it("times out a hanging process", async () => {
    const m = new CliMessenger({ claudePath: fakeBin("fake-claude-hang.mjs") });
    expect((await m.send({ prompt: "hi", timeoutMs: 300 }).done).error?.kind).toBe("timeout");
  });

  it("cancels with an AbortSignal", async () => {
    const m = new CliMessenger({ claudePath: fakeBin("fake-claude-hang.mjs") });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    expect((await m.send({ prompt: "hi", signal: controller.signal }).done).error?.kind).toBe("aborted");
  });

  it("writes a replayable trace plus metadata when traceDir is set", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "orca-test-trace-"));
    const m = new CliMessenger({ claudePath: fakeBin("fake-claude.mjs"), traceDir });
    const done = await m.send({ prompt: "hi" }).done;

    expect(done.tracePath).toBeDefined();
    const lines = readFileSync(done.tracePath!, "utf8").trim().split("\n");
    expect(JSON.parse(lines.at(-1)!).type).toBe("result");

    const metaPath = done.tracePath!.replace(/\.jsonl$/, ".meta.json");
    expect(existsSync(metaPath)).toBe(true);
    expect(JSON.parse(readFileSync(metaPath, "utf8"))).toMatchObject({ request: { prompt: "hi" }, done: { ok: true } });
  });
});
