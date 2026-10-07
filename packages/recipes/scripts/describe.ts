// Run pr-describe on a branch and print the PR title and body.
//
//   pnpm --filter @orchestra/recipes describe [base] [head]
//
// Defaults: base=origin/main, head=HEAD. Describes `git diff base...head` of the
// repo this is run in. e.g. to describe the current branch against main:
//
//   pnpm --filter @orchestra/recipes describe main HEAD
//
// Evidence of what actually ran (so the description's testing claims are honest)
// is read from the ORCA_EVIDENCE env var as a JSON array, e.g.
//
//   ORCA_EVIDENCE='[{"recipe":"test","ok":true,"gatesPassed":["commandPasses: pnpm test"]}]'
//
// With no evidence, pr-describe's claimsMatchEvidence gate forces an empty testing
// section. This spawns a real Claude run on your subscription (read-only).
import { createEngine } from "@orchestra/engine";
import { createMessenger } from "@orchestra/messenger";
import { type PrDescribeResult, prDescribe } from "../src/pr-describe/index.js";

const repo = process.cwd();
const base = process.argv[2] ?? "origin/main";
const head = process.argv[3] ?? "HEAD";
const evidenceJson = process.env["ORCA_EVIDENCE"];
const evidence = evidenceJson ? JSON.parse(evidenceJson) : [];

const engine = createEngine({
  repo,
  messenger: createMessenger({ backend: "cli" }),
  recipes: { "pr-describe": prDescribe },
  // A description never edits, so there's nothing to inspect afterward; dropping
  // worktrees keeps an ad-hoc run from leaving dirs under the repo.
  keepWorktrees: "never",
});

const run = engine.start("pr-describe", { base, head, evidence });

for await (const e of run.events) {
  if (e.type === "task.started") console.log(`▶ describing (attempt ${e.attempt})`);
  else if (e.type === "gate.failed") console.log(`  ✗ ${e.gate}: ${e.reasons[0] ?? ""}`);
  else if (e.type === "task.done") console.log(`✓ description done  $${e.costUsd.toFixed(3)}`);
  else if (e.type === "task.failed") console.log(`✗ no valid description: ${e.reasons[0] ?? ""}`);
}

const result = await run.done;
if (result.status !== "completed") {
  console.error(`\nrun ${result.status}: ${result.error?.message ?? "no description produced"}`);
  process.exit(1);
}

const out = result.output as PrDescribeResult | null;
if (!out) {
  console.error("\nno description produced (empty diff?)");
  process.exit(1);
}
console.log(`\n=== TITLE ===\n${out.title}`);
console.log(`\n=== BODY ===\n${out.body}`);
console.log(`\ncost $${result.costUsd.toFixed(3)}`);
