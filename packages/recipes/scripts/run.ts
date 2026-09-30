// Phase 1 checkpoint: run fix-ci on a real repo with the CLI backend.
//
//   pnpm --filter @orchestra/recipes demo <repo-path> "<command>"
//
// e.g. pnpm --filter @orchestra/recipes demo /tmp/scratch "npx tsc --noEmit"
import { createEngine } from "@orchestra/engine";
import { createMessenger } from "@orchestra/messenger";
import { fixCi } from "../src/index.js";

const repo = process.argv[2];
const command = process.argv[3] ?? "npx tsc --noEmit";
if (!repo) {
  console.error('usage: demo <repo-path> "<command>"');
  process.exit(1);
}

const engine = createEngine({
  repo,
  messenger: createMessenger({ backend: "cli" }),
  recipes: { "fix-ci": fixCi },
});

const run = engine.start("fix-ci", { command });

for await (const e of run.events) {
  if (e.type === "task.started") console.log(`▶ ${e.taskId} (attempt ${e.attempt})`);
  else if (e.type === "task.done") console.log(`✓ ${e.taskId}  $${e.costUsd.toFixed(3)}`);
  else console.log(e.type);
}

const result = await run.done;
console.log("\n=== result ===");
console.log(
  JSON.stringify(
    { ...result, tasks: result.tasks.map((t) => ({ ...t, diff: undefined })) },
    null,
    2,
  ),
);
console.log("\n=== diff ===");
console.log(result.tasks[0]?.diff ?? "(no diff)");
