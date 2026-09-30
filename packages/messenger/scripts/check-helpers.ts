import { z } from "zod";
import type { Messenger, MessengerRequest } from "../src/index.js";
import {
  ask,
  askJson,
  collect,
  conversation,
  extractJson,
  MessengerError,
} from "../src/index.js";
import { createRun } from "../src/run.js";

/** Replies with the next canned answer each time send() is called, and logs what it received. */
function scripted(
  replies: string[],
): Messenger & { calls: MessengerRequest[] } {
  const calls: MessengerRequest[] = [];
  let i = 0;
  return {
    calls,
    send(req) {
      calls.push(req);
      const text = replies[i++] ?? "(no more replies)";
      return createRun(async (emit) => {
        emit({ type: "message", text });
        return {
          type: "done",
          ok: true,
          text,
          sessionId: "s-1",
          costUsd: 0.01,
          turns: 1,
        };
      });
    },
  };
}

// 1. collect
{
  const m = scripted(["hello"]);
  const { events, done } = await collect(m.send({ prompt: "hi" }));
  console.log(
    "1 collect:",
    events.map((e) => e.type),
    done.text,
  );
}

// 2. ask: talk-only, one turn
{
  const m = scripted(["Hi there!"]);
  const done = await ask(m, "say hi", { model: "haiku" });
  console.log("2 ask:", done.text, "| sent:", {
    tools: m.calls[0]?.tools,
    maxTurns: m.calls[0]?.maxTurns,
    model: m.calls[0]?.model,
  });
}

// 3. conversation: system only on turn 1, resume from turn 2, cost adds up
{
  const m = scripted(["ok", "Teal."]);
  const chat = conversation(m, { system: "Be terse." });
  await chat.send("My favorite color is teal.");
  const second = await chat.send("What's my favorite color?");
  console.log(
    "3 conversation:",
    second.text,
    "| session:",
    chat.sessionId,
    "| cost:",
    chat.costUsd,
  );
  console.log("   turn 1 →", {
    system: m.calls[0]?.system,
    resume: m.calls[0]?.resume,
  });
  console.log("   turn 2 →", {
    system: m.calls[1]?.system,
    resume: m.calls[1]?.resume,
  });
}

// 4. extractJson: the shapes models actually return
{
  const cases = [
    '{"a":1}',
    'Sure! Here you go:\n```json\n{"a":2}\n```',
    'The answer is {"a":3} hope that helps',
    "[1,2,3]",
    "not json at all",
  ];
  console.log(
    "4 extractJson:",
    cases.map((c) => JSON.stringify(extractJson(c))).join("  |  "),
  );
}

// 5. askJson: first reply is wrong, the retry fixes it
const Triage = z.object({
  category: z.enum(["real_bug", "test_bug", "timing", "environment"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});
{
  const m = scripted([
    'I think it\'s timing. {"category":"timing","confidence":"high"}', // wrong: confidence is a string, reason missing
    '```json\n{"category":"timing","confidence":0.8,"reason":"fails only under parallel load"}\n```',
  ]);
  const result = await askJson(m, "Classify this failure.", Triage);
  console.log("5 askJson:", result);
  console.log(
    "   retry message sent back:\n  ",
    m.calls[1]?.prompt.replaceAll("\n", "\n   "),
  );
}

// 6. askJson gives up after retries and throws a typed error
{
  const m = scripted(["nope", "still nope", "no"]);
  try {
    await askJson(m, "Classify this failure.", Triage, { retries: 2 });
  } catch (err) {
    if (err instanceof MessengerError)
      console.log(
        "6 askJson gave up:",
        err.kind,
        "| calls made:",
        m.calls.length,
      );
    else throw err;
  }
}
