// Run the Bug to PR chain on a real repo: a bug report in, a draft PR out.
//
//   pnpm --filter @orchestra/recipes bug-to-pr --issue 42
//   pnpm --filter @orchestra/recipes bug-to-pr --report "median([1,2,3,4]) returns 3, should be 2.5"
//
// Flags:
//   --issue <n>      a GitHub issue to read and link (needs --github or a local
//                    .orca/issues/<n>.md for the local sink)
//   --report "<t>"   the bug report text directly, instead of an issue
//   --base <branch>  the branch PRs open against (default main)
//   --test "<cmd>"   the test command repro-bug scopes to its file
//   --github         open a real draft PR with `gh`; otherwise a local sink writes
//                    the PR and comments under .orca/ (a dry run)
//   --repo <path>    the repo to work in (default cwd)
//
// This spawns several real Claude runs on your subscription under one budget.

import path from "node:path";
import { parseArgs } from "node:util";
import { createEngine, githubSink, localSink } from "@orchestra/engine";
import { createMessenger } from "@orchestra/messenger";
import type { BugToPrOutput } from "../src/bug-to-pr/index.js";
import { bugToPr } from "../src/bug-to-pr/index.js";

const { values } = parseArgs({
  options: {
    issue: { type: "string" },
    report: { type: "string" },
    base: { type: "string" },
    test: { type: "string" },
    github: { type: "boolean" },
    repo: { type: "string" },
  },
});

const repo = path.resolve(values.repo ?? process.cwd());
if (!values.issue && !values.report) {
  console.error('give --issue <n> or --report "<text>"');
  process.exit(1);
}

const engine = createEngine({
  repo,
  messenger: createMessenger({ backend: "cli" }),
  recipes: { "bug-to-pr": bugToPr },
  pr: values.github ? githubSink({ repo }) : localSink({ dir: path.join(repo, ".orca") }),
});

const input: Record<string, unknown> = {};
if (values.issue) input["issue"] = Number(values.issue);
if (values.report) input["report"] = values.report;
if (values.base) input["base"] = values.base;
if (values.test) input["test"] = values.test;

const run = engine.start("bug-to-pr", input);

for await (const e of run.events) {
  if (e.type === "step.started") console.log(`→ ${e.name}`);
  else if (e.type === "child.started") console.log(`  ▶ ${e.recipe}`);
  else if (e.type === "child.done") {
    const tag = e.result.ok ? "✓" : "✗";
    console.log(`  ${tag} ${e.recipe}  ${e.result.status}  $${e.result.costUsd.toFixed(3)}`);
  }
}

const result = await run.done;
const out = result.output as BugToPrOutput | undefined;

console.log("\n=== result ===");
if (!out) {
  console.error(`run ${result.status}: ${result.error?.message ?? "no output"}`);
  process.exit(1);
}
console.log(`status:  ${out.status}`);
if (out.prUrl) console.log(`PR:      ${out.prUrl}`);
if (out.branch) console.log(`branch:  ${out.branch}`);
if (out.verdict) console.log(`review:  ${out.verdict}`);
console.log(`cost:    $${out.costUsd.toFixed(3)}`);
for (const s of out.steps) {
  console.log(`  ${s.ok ? "✓" : "✗"} ${s.name}  $${s.costUsd.toFixed(3)}`);
}

process.exit(out.status === "pr_opened" || out.status === "repro_only" ? 0 : 1);
