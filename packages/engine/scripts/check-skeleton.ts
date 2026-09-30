// Deterministic Phase 1 end-to-end check — no live Claude needed.
//
// Uses a scripted Messenger that actually edits the worktree (a real FakeMessenger
// replays events but leaves files untouched, so gates/diffs would have nothing to
// see). Proves: plan → worktree → worker → diff → finish, with a real git worktree.
//
//   pnpm --filter @orchestra/engine exec tsx scripts/check-skeleton.ts
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { DoneEvent, Messenger, MessengerEvent, MessengerRun } from "@orchestra/messenger";
import { z } from "zod";
import { createEngine } from "../src/engine.js";
import { defineRecipe } from "../src/recipe.js";

const exec = promisify(execFile);
const git = (cwd: string, args: string[]) => exec("git", args, { cwd });

async function makeScratchRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "orca-skeleton-"));
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "test@orca.dev"]);
  await git(dir, ["config", "user.name", "Orca Test"]);
  await writeFile(path.join(dir, "index.ts"), "export const answer = 'wrong';\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

/** A Messenger that pretends to be Claude and writes a file into the worktree. */
const scriptedMessenger: Messenger = {
  send(req): MessengerRun {
    const work = (async (): Promise<DoneEvent> => {
      await writeFile(path.join(req.cwd ?? ".", "index.ts"), "export const answer = 42;\n");
      return { type: "done", ok: true, costUsd: 0.012, turns: 1, text: "fixed it" };
    })();

    async function* events(): AsyncGenerator<MessengerEvent> {
      yield { type: "message", text: "Editing the worktree…" };
      yield await work; // the done event lands on the stream, then it ends
    }

    return { events: events(), done: work };
  },
};

const demoRecipe = defineRecipe({
  name: "demo",
  description: "scripted skeleton check",
  input: z.object({ target: z.string() }),
  async plan(input) {
    return [{ id: "fix", goal: `fix ${input.target}`, dependsOn: [], context: input }];
  },
  worker: (task) => ({ prompt: task.goal, tools: ["Read", "Edit"], maxTurns: 5 }),
  gates: [],
  async finish(results) {
    return { fixed: results.every((r) => r.ok) };
  },
});

const repo = await makeScratchRepo();
console.log("scratch repo:", repo);

const engine = createEngine({
  repo,
  messenger: scriptedMessenger,
  recipes: { demo: demoRecipe },
});

const run = engine.start("demo", { target: "index.ts" });
console.log("run id:", run.id);

for await (const e of run.events) {
  if (e.type === "worker.event") console.log("  worker.event:", e.event.type);
  else if (e.type === "run.done") console.log("event: run.done");
  else console.log("event:", e.type, "taskId" in e ? e.taskId : "");
}

const result = await run.done;
const diff = result.tasks[0]?.diff ?? "";
const pass =
  result.ok &&
  result.status === "completed" &&
  diff.includes("answer = 42") &&
  (result.output as { fixed: boolean }).fixed === true;

console.log("\n=== result ===");
console.log(
  JSON.stringify(
    { ...result, tasks: result.tasks.map((t) => ({ ...t, diff: "<omitted>" })) },
    null,
    2,
  ),
);
console.log("\n=== diff ===\n" + diff);
console.log(pass ? "\n✅ Phase 1 skeleton works: a diff came back." : "\n❌ skeleton check FAILED");
process.exit(pass ? 0 : 1);
