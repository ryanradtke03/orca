// pnpm tsx packages/messenger/scripts/record.ts talk-real "say hi in 3 words"
// pnpm tsx packages/messenger/scripts/record.ts tools-real "Read notes.txt and tell me the secret word" --tools Read --max-turns 5
// pnpm tsx packages/messenger/scripts/record.ts max-turns-real "Read every file here one by one" --tools Read,Glob --max-turns 1
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CliMessenger } from "../src/index.js";
import { scrub } from "../src/scrub.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    tools: { type: "string" },
    "max-turns": { type: "string" },
    model: { type: "string", default: "sonnet" },
    cwd: { type: "string" },
  },
});
const [name, prompt] = positionals;
if (!name || !prompt) {
  console.error(
    'usage: record.ts <name> "<prompt>" [--tools Read,Grep] [--max-turns N] [--model sonnet] [--cwd dir]',
  );
  process.exit(1);
}

const tools = values.tools ? values.tools.split(",") : [];
let cwd = values.cwd;
if (tools.length > 0 && !cwd) {
  // Tool runs need a folder: make a throwaway one with a harmless file in it
  cwd = await mkdtemp(join(tmpdir(), "orca-record-"));
  await writeFile(join(cwd, "notes.txt"), "the secret word is teal\n");
}

const fixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));
const traceDir = await mkdtemp(join(tmpdir(), "orca-trace-"));
const isolated = join(homedir(), ".claude-orca");

const m = new CliMessenger({
  traceDir,
  defaultModel: values.model,
  configDir: existsSync(isolated) ? isolated : undefined,
});
const run = m.send({
  prompt,
  tools,
  cwd,
  maxTurns: values["max-turns"] ? Number(values["max-turns"]) : undefined,
});

for await (const e of run.events)
  if (e.type !== "raw") console.log(e.type, e.type === "message" ? e.text : "");
const done = await run.done;
if (!done.tracePath) throw new Error("no trace was written");

// Save scrubbed copies: no home path, username or email in committed fixtures
const copyScrubbed = async (from: string, to: string) =>
  writeFile(to, scrub(await readFile(from, "utf8")));
await copyScrubbed(done.tracePath, join(fixturesDir, `${name}.jsonl`));
await copyScrubbed(
  done.tracePath.replace(/\.jsonl$/, ".meta.json"),
  join(fixturesDir, `${name}.meta.json`),
);
console.log(
  `\nsaved fixtures/${name}.jsonl  (ok=${done.ok}, $${done.costUsd?.toFixed(4)})`,
);
