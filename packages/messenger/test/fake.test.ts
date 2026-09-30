import { describe, expect, it } from "vitest";
import { collect, FakeMessenger } from "../src/index.js";
import { fixture, reply } from "./helpers.js";

describe("FakeMessenger", () => {
  it("replays a recorded tool run through the real pipeline", async () => {
    const m = new FakeMessenger({ fixtures: [fixture("tools.jsonl")] });
    const { events, done } = await collect(m.send({ prompt: "read it", tools: ["Read"], cwd: process.cwd() }));
    expect(events.filter((e) => e.type !== "raw").map((e) => e.type)).toEqual(["tool_use", "tool_result", "message", "done"]);
    expect(done).toMatchObject({ ok: true, turns: 2 });
    expect(m.calls[0]?.tools).toEqual(["Read"]);
  });

  it("fails clearly when it runs out of fixtures", async () => {
    const m = new FakeMessenger({ fixtures: [] });
    const done = await m.send({ prompt: "hi" }).done;
    expect(done.error?.kind).toBe("no_result");
  });

  it("applies the same validation as the real backend", async () => {
    const m = new FakeMessenger({ fixtures: [reply("hi")] });
    const done = await m.send({ prompt: "edit", tools: ["Edit"] }).done;
    expect(done.error?.kind).toBe("invalid_request");
  });

  it("reports a non-zero exit code like the real backend", async () => {
    const m = new FakeMessenger({ fixtures: [reply("hi")], exitCode: 1 });
    expect((await m.send({ prompt: "hi" }).done).error?.kind).toBe("exit_code");
  });
});
