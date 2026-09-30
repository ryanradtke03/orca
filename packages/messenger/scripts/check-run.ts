// Proves events stream live (not all at the end) and done always resolves.
import { createRun } from "../src/run.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const start = Date.now();
const t = () => `${String(Date.now() - start).padStart(4)}ms`;

// 1. live streaming: each event should print ~300ms apart
const run = createRun(async (emit) => {
  for (const word of ["one", "two", "three"]) {
    await sleep(300);
    emit({ type: "message", text: word });
  }
  return { type: "done", ok: true, text: "finished" };
});
for await (const e of run.events)
  console.log(t(), e.type, e.type === "message" ? e.text : "");

// 2. done resolves without anyone reading events
const quiet = createRun(async (emit) => {
  emit({ type: "message", text: "nobody reads this" });
  return { type: "done", ok: true };
});
console.log(t(), "done only:", await quiet.done);

// 3. a producer that throws still gives a done, it doesn't crash
const broken = createRun(async () => {
  throw new Error("boom");
});
console.log(t(), "broken:", await broken.done);
