// `orca runs [--limit <n>]` — list past runs from the trace dir.
// Reads engine.runs() (newest-first); no Claude, no spend.
import { parseArgs } from "node:util";
import { CliError } from "../cli-error.js";
import { loadConfig } from "../config.js";
import { buildEngine } from "../engine-factory.js";

export async function run(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      config: { type: "string" },
      github: { type: "boolean" },
      json: { type: "boolean" },
      limit: { type: "string" },
    },
  });

  let limit: number | undefined;
  if (values.limit !== undefined) {
    limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1)
      throw new CliError(`--limit expects a positive integer, got: ${values.limit}`);
  }

  const config = await loadConfig({
    repo: values.repo,
    config: values.config,
    github: values.github,
  });
  const all = await buildEngine(config).runs();
  const rows = limit === undefined ? all : all.slice(0, limit);

  if (values.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log("no runs yet");
    return;
  }
  for (const r of rows) {
    const tag = r.ok ? "✓" : "✗";
    console.log(`${tag} ${r.id}  ${r.status.padEnd(9)}  $${r.costUsd.toFixed(3)}  ${r.finishedAt}`);
  }
}
