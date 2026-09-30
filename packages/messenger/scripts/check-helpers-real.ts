import { z } from "zod";
import { ask, askJson, conversation, createMessenger } from "../src/index.js";

const m = createMessenger({ backend: "cli", defaultModel: "sonnet" });

// ask
const hi = await ask(m, "Say hi in exactly 3 words.");
console.log("ask →", hi.ok ? hi.text : hi.error);

// conversation
const chat = conversation(m, { system: "Answer in one short sentence." });
await chat.send("My favorite color is teal. Just say ok.");
const color = await chat.send("What's my favorite color?");
console.log("conversation →", color.text, `| $${chat.costUsd.toFixed(4)}`);

// askJson: a realistic triage-style call
const Triage = z.object({
  category: z.enum([
    "real_bug",
    "test_bug",
    "timing",
    "test_data",
    "environment",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string().describe("one sentence"),
});
const triage = await askJson(
  m,
  `A Playwright test "applies discount code" passes alone but fails about 40% of the time
when run with 4 parallel workers. Every failure times out on the same line waiting for
"Discount applied". All tests use the discount code SAVE10, which the app only allows once.
Classify the most likely cause.`,
  Triage,
);
console.log("askJson →", triage);
