import { describe, expect, it } from "vitest";
import { createRun } from "../src/run.js";
import type { MessengerEvent } from "../src/types.js";

describe("createRun", () => {
  it("resolves done even if nobody reads events", async () => {
    const run = createRun(async (emit) => {
      emit({ type: "message", text: "unread" });
      return { type: "done", ok: true };
    });
    await expect(run.done).resolves.toMatchObject({ ok: true });
  });

  it("puts done on the stream exactly once, last", async () => {
    const run = createRun(async (emit) => {
      emit({ type: "message", text: "a" });
      emit({ type: "message", text: "b" });
      return { type: "done", ok: true };
    });
    const events: MessengerEvent[] = [];
    for await (const e of run.events) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["message", "message", "done"]);
  });

  it("turns a throwing producer into a failed done instead of crashing", async () => {
    const run = createRun(async () => {
      throw new Error("boom");
    });
    await expect(run.done).resolves.toMatchObject({
      ok: false,
      error: { kind: "spawn", message: "boom" },
    });
  });
});
