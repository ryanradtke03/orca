// `orca describe <recipe>` — print a recipe's JSON input schema.
// Reads engine.recipes(); no Claude, no spend.
import { parseArgs } from "node:util";
import { CliError } from "../cli-error.js";
import { loadConfig } from "../config.js";
import { buildEngine } from "../engine-factory.js";

export async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      config: { type: "string" },
      github: { type: "boolean" },
    },
  });

  const name = positionals[0];
  if (!name) throw new CliError("usage: orca describe <recipe>");

  const config = await loadConfig({
    repo: values.repo,
    config: values.config,
    github: values.github,
  });
  const info = buildEngine(config)
    .recipes()
    .find((r) => r.name === name);
  if (!info) {
    throw new CliError(`unknown recipe: ${name}\nRun "orca list" to see available recipes.`);
  }

  console.log(JSON.stringify(info.inputSchema, null, 2));
}
