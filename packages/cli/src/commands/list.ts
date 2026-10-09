// `orca list` — list available recipes and chains with their descriptions.
// Reads engine.recipes(); no Claude, no spend.
import { parseArgs } from "node:util";
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
    },
  });

  const config = await loadConfig({
    repo: values.repo,
    config: values.config,
    github: values.github,
  });
  const recipes = buildEngine(config).recipes();

  if (values.json) {
    console.log(JSON.stringify(recipes, null, 2));
    return;
  }

  const width = recipes.reduce((w, r) => Math.max(w, r.name.length), 0);
  for (const r of recipes) {
    console.log(`${r.name.padEnd(width)}  ${r.description}`);
  }
}
