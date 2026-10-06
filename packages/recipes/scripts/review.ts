// Run pr-review on a branch and print the review.
//
//   pnpm --filter @orchestra/recipes review [base] [head] [issue]
//
// Defaults: base=origin/main, head=HEAD. Reviews `git diff base...head` of the
// repo this is run in. e.g. to review the current branch against main:
//
//   pnpm --filter @orchestra/recipes review origin/main HEAD
//
// This spawns a real Claude run on your subscription (read-only: Read/Grep/Glob,
// no edits). The worktree is cut from the repo's current HEAD, so check out the
// branch you're reviewing (or pass it as `head`) before running.
import { createEngine } from "@orchestra/engine";
import { createMessenger } from "@orchestra/messenger";
import { prReview, type Review } from "../src/pr-review/index.js";

const repo = process.cwd();
const base = process.argv[2] ?? "origin/main";
const head = process.argv[3] ?? "HEAD";
const issue = process.argv[4];

const engine = createEngine({
  repo,
  messenger: createMessenger({ backend: "cli" }),
  recipes: { "pr-review": prReview },
  // A review never edits, so there's nothing to inspect in a worktree afterward.
  // Drop them so an ad-hoc review doesn't leave dirs under the repo (which also
  // trips up vitest's file globbing).
  keepWorktrees: "never",
});

const run = engine.start("pr-review", { base, head, ...(issue ? { issue } : {}) });

for await (const e of run.events) {
  if (e.type === "task.started") console.log(`▶ reviewing (attempt ${e.attempt})`);
  else if (e.type === "gate.failed") console.log(`  ✗ ${e.gate}: ${e.reasons[0] ?? ""}`);
  else if (e.type === "task.done") console.log(`✓ review done  $${e.costUsd.toFixed(3)}`);
  else if (e.type === "task.failed") console.log(`✗ no valid review: ${e.reasons[0] ?? ""}`);
}

const result = await run.done;
if (result.status !== "completed") {
  console.error(`\nrun ${result.status}: ${result.error?.message ?? "no review produced"}`);
  process.exit(1);
}

const review = result.output as Review;
console.log(`\n=== ${review.verdict.toUpperCase()} ===`);
console.log(review.summary);
for (const c of review.comments) {
  const tag = c.severity === "blocking" ? "BLOCKING" : "suggestion";
  console.log(`\n[${tag}] ${c.file}:${c.line}\n  ${c.body.replace(/\n/g, "\n  ")}`);
}
console.log(`\ncost $${result.costUsd.toFixed(3)} · ${review.comments.length} comment(s)`);
