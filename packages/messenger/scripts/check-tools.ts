// Run: pnpm tsx packages/messenger/scripts/check-tools.ts          (real Claude, uses Read in a temp folder)
//      pnpm tsx packages/messenger/scripts/check-tools.ts --fake   (no Claude)
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMessenger } from "../src/index.js";

const useFake = process.argv.includes("--fake");
const claudePath = useFake ? fileURLToPath(new URL("../test/fake-claude-tools.mjs", import.meta.url)) : undefined;

// A throwaway folder with one file, so the worker has something to read
const dir = mkdtempSync(join(tmpdir(), "orca-tools-"));
writeFileSync(join(dir, "notes.txt"), "the secret word is teal\n");

const m = createMessenger({ backend: "cli", claudePath, defaultModel: "sonnet" });
const run = m.send({
  prompt: "Read notes.txt and tell me the secret word. Answer in one short sentence.",
  cwd: dir,
  tools: ["Read"],
  maxTurns: 5,
});

const short = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};

for await (const e of run.events) {
  switch (e.type) {
    case "message":     console.log(`💬 ${e.text}`); break;
    case "tool_use":    console.log(`🔧 ${e.name}(${short(e.input)})  [${e.id}]`); break;
    case "tool_result": console.log(`${e.isError ? "❌" : "✅"} ${e.name ?? "?"} → ${short(e.output)}`); break;
    case "raw":         break; // hide system / rate-limit lines
    case "done":        console.log(`\ndone ok=${e.ok} turns=${e.turns} cost=$${e.costUsd?.toFixed(4)}`, e.error ?? ""); break;
  }
}
