// Run: pnpm tsx packages/messenger/scripts/check-spawn.ts "say hi in 3 words"
// Add --fake to use test/fake-claude.mjs instead of real Claude.
import { fileURLToPath } from "node:url";
import { createMessenger } from "../src/index.js";

const useFake = process.argv.includes("--fake");
const prompt =
  process.argv.slice(2).find((a) => a !== "--fake") ?? "say hi in 3 words";
const claudePath = useFake
  ? fileURLToPath(new URL("../test/fake-claude.mjs", import.meta.url))
  : undefined;

const m = createMessenger({ backend: "cli", claudePath });
const run = m.send({ prompt });

for await (const e of run.events) {
  if (e.type === "raw") {
    const r = e.msg as { type?: string; subtype?: string };
    console.log(
      `raw      ${r?.type ?? "?"}${r?.subtype ? `/${r.subtype}` : ""}`,
    );
  } else if (e.type === "message") {
    console.log(`message  ${e.text}`);
  } else {
    console.log(e.type.padEnd(8), e);
  }
}
