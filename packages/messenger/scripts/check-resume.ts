// scripts/check-resume.ts
import { createMessenger } from "../src/index.js";
const m = createMessenger({ backend: "cli", defaultModel: "sonnet" });

const first = await m.send({
  prompt: "My favorite color is teal. Just say ok.",
}).done;
console.log("1:", first.text, first.sessionId);

const second = await m.send({
  prompt: "What's my favorite color?",
  resume: first.sessionId,
}).done;
console.log("2:", second.text, second.sessionId);
