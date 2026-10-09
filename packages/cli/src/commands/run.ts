// `orca run <recipe> [--set k=v]... [--input-json '<json>'] [--base <ref>]`
// Build an engine, start a run, stream its events to stderr, print the result to
// stdout, and exit non-zero if the run didn't succeed. This is the one command that
// spends (it drives real Claude runs).
import { parseArgs } from "node:util";
import type { Messenger } from "@orchestra/messenger";
import { CliError } from "../cli-error.js";
import { loadConfig } from "../config.js";
import { buildEngine } from "../engine-factory.js";
import { streamEvents } from "../events.js";

/** Coerce a --set value: parse as JSON when it can be (numbers, booleans, objects),
 *  otherwise keep the raw string. So `--set issue=42` → 42 and `--set report=hi` → "hi". */
function coerce(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** Assemble the recipe input: an --input-json object as the base, then --set overrides. */
export function buildInput(json: string | undefined, sets: string[]): Record<string, unknown> {
  let input: Record<string, unknown> = {};
  if (json !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      throw new CliError(`--input-json is not valid JSON: ${(err as Error).message}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new CliError("--input-json must be a JSON object");
    }
    input = parsed as Record<string, unknown>;
  }
  for (const pair of sets) {
    const eq = pair.indexOf("=");
    const key = eq === -1 ? "" : pair.slice(0, eq);
    if (!key) throw new CliError(`--set expects key=value, got: ${pair}`);
    input[key] = coerce(pair.slice(eq + 1));
  }
  return input;
}

/** Injectable collaborators; tests pass a fake messenger so no real `claude` runs. */
export interface RunDeps {
  messenger?: Messenger | undefined;
}

export async function run(args: string[], deps: RunDeps = {}): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      config: { type: "string" },
      github: { type: "boolean" },
      base: { type: "string" },
      "input-json": { type: "string" },
      set: { type: "string", multiple: true },
      verbose: { type: "boolean" },
    },
  });

  const name = positionals[0];
  if (!name) {
    throw new CliError(
      "usage: orca run <recipe> [--set k=v]... [--input-json '<json>'] [--base <ref>]",
    );
  }

  const input = buildInput(values["input-json"], values.set ?? []);
  const config = await loadConfig({
    repo: values.repo,
    config: values.config,
    github: values.github,
    base: values.base,
  });

  const engine = buildEngine(config, deps);
  if (!engine.recipes().some((r) => r.name === name)) {
    throw new CliError(`unknown recipe: ${name}\nRun "orca list" to see available recipes.`);
  }

  // Make the targeted repo visible (the pnpm-cwd gotcha), on stderr.
  process.stderr.write(`→ repo: ${config.repo}\n`);

  const started = engine.start(name, input, config.base ? { base: config.base } : {});
  await streamEvents(started, { verbose: values.verbose });
  const result = await started.done; // never throws (engine contract)

  // Result → stdout (the recipe's output, machine-readable).
  console.log(JSON.stringify(result.output ?? null, null, 2));

  // Exit 2 on a run that didn't succeed, with a one-line reason on stderr.
  if (!result.ok) {
    throw new CliError(`run ${result.status}: ${result.error?.message ?? "no output"}`, 2);
  }
}
