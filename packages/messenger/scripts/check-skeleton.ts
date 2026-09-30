import { createMessenger } from "../src/index.js";

const m = createMessenger({ backend: "cli" });

// 1. done resolves without reading events
const d1 = await m.send({ prompt: "hi" }).done;
console.log("done only:", d1);

// 2. reading events gives the message, then done
const run = m.send({ prompt: "hello again" });
for await (const e of run.events) console.log("event:", e);
console.log("done:", await run.done);
