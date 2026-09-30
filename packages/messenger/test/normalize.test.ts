import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createNormalizer } from "../src/normalize.js";
import { fixture } from "./helpers.js";

const eventsFor = (name: string) => {
  const normalize = createNormalizer();
  return readFileSync(fixture(name), "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => normalize(JSON.parse(line)));
};

const fixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));
const realFixtures = readdirSync(fixturesDir).filter((f) =>
  f.endsWith("-real.jsonl"),
);

describe("createNormalizer", () => {
  it("maps a talk-only run to raw, message, raw, done", () => {
    const events = eventsFor("talk.jsonl");
    expect(events.map((e) => e.type)).toEqual([
      "raw",
      "message",
      "raw",
      "done",
    ]);
    expect(events[3]).toMatchObject({
      type: "done",
      ok: true,
      text: "Hi there, friend!",
      sessionId: "talk-1",
      turns: 1,
    });
  });

  it("pairs tool_result with its tool_use name by id", () => {
    const events = eventsFor("tools.jsonl");
    const use = events.find((e) => e.type === "tool_use");
    const result = events.find((e) => e.type === "tool_result");
    expect(use).toMatchObject({ name: "Read", id: "toolu_01" });
    expect(result).toMatchObject({
      name: "Read",
      toolUseId: "toolu_01",
      isError: false,
    });
  });

  it("treats an error_* subtype as a failure even when is_error is false", () => {
    const done = eventsFor("max-turns.jsonl").at(-1);
    expect(done).toMatchObject({
      type: "done",
      ok: false,
      error: { kind: "max_turns", message: "error_max_turns" },
    });
  });

  it("classifies a real max-turns result as max_turns", () => {
    const done = eventsFor("max-turns-real.jsonl").at(-1);
    expect(done).toMatchObject({
      type: "done",
      ok: false,
      error: {
        kind: "max_turns",
        message: "Reached maximum number of turns (1)",
      },
    });
  });

  it("uses Claude's errors[] as the message when present", () => {
    const [done] = createNormalizer()({
      type: "result",
      subtype: "error_max_turns",
      is_error: true,
      terminal_reason: "max_turns",
      errors: ["Reached maximum number of turns (1)"],
      num_turns: 2,
    });
    expect(done).toMatchObject({
      ok: false,
      error: {
        kind: "max_turns",
        message: "Reached maximum number of turns (1)",
      },
    });
  });

  it("flattens array tool results made of text blocks", () => {
    const normalize = createNormalizer();
    normalize({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Grep", input: {} }],
      },
    });
    const [e] = normalize({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [
              { type: "text", text: "a" },
              { type: "text", text: "b" },
            ],
            is_error: true,
          },
        ],
      },
    });
    expect(e).toEqual({
      type: "tool_result",
      toolUseId: "t1",
      name: "Grep",
      output: "a\nb",
      isError: true,
    });
  });
});

describe("real recorded fixtures", () => {
  it.each(realFixtures)("%s normalizes cleanly and ends with a done", (name) => {
    expect(eventsFor(name).at(-1)?.type).toBe("done");
  });
});
