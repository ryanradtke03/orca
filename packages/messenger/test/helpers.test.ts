import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ask, askJson, conversation, extractJson, FakeMessenger, MessengerError } from "../src/index.js";
import { reply } from "./helpers.js";

describe("ask", () => {
  it("sends a talk-only, single-turn request", async () => {
    const m = new FakeMessenger({ fixtures: [reply("Hi!")] });
    const done = await ask(m, "say hi", { model: "haiku" });
    expect(done.text).toBe("Hi!");
    expect(m.calls[0]).toMatchObject({ tools: [], maxTurns: 1, model: "haiku" });
  });
});

describe("conversation", () => {
  it("sends system only on the first turn and resumes after that", async () => {
    const m = new FakeMessenger({ fixtures: [reply("ok", "s-9"), reply("Teal.", "s-9")] });
    const chat = conversation(m, { system: "Be terse." });
    await chat.send("My favorite color is teal.");
    const second = await chat.send("What's my favorite color?");
    expect(second.text).toBe("Teal.");
    expect(m.calls[0]).toMatchObject({ system: "Be terse.", resume: undefined });
    expect(m.calls[1]).toMatchObject({ system: undefined, resume: "s-9" });
    expect(chat.costUsd).toBeCloseTo(0.02);
  });
});

describe("extractJson", () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['Sure:\n```json\n{"a":2}\n```', { a: 2 }],
    ['The answer is {"a":3} ok', { a: 3 }],
    ["[1,2]", [1, 2]],
    ["not json", undefined],
  ])("%s", (text, expected) => {
    expect(extractJson(text)).toEqual(expected);
  });
});

describe("askJson", () => {
  const Triage = z.object({ category: z.enum(["timing", "test_data"]), confidence: z.number() });

  it("retries in the same conversation with the validation errors", async () => {
    const m = new FakeMessenger({
      fixtures: [reply('{"category":"timing","confidence":"high"}'), reply('{"category":"timing","confidence":0.8}')],
    });
    await expect(askJson(m, "classify", Triage)).resolves.toEqual({ category: "timing", confidence: 0.8 });
    expect(m.calls[1]?.resume).toBe("s-1");
    expect(m.calls[1]?.prompt).toContain("confidence");
  });

  it("throws invalid_json after running out of retries", async () => {
    const m = new FakeMessenger({ fixtures: [reply("nope"), reply("nope"), reply("nope")] });
    const err = await askJson(m, "classify", Triage, { retries: 2 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MessengerError);
    expect((err as MessengerError).kind).toBe("invalid_json");
    expect(m.calls).toHaveLength(3);
  });
});
