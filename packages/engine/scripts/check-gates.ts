// Deterministic Phase 2 check — gates + retry, no live Claude.
//
//   pnpm --filter @orchestra/engine exec tsx scripts/check-gates.ts
//
// Covers the three checkpoint cases from the design:
//   1. commandPasses passes when the worker does the work
//   2. an @ts-expect-error is rejected, and the reason reaches attempt 2's prompt (retry succeeds)
//   3. an impossible gate retries maxAttempts times, then fails with reasons
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { DoneEvent, Messenger, MessengerEvent, MessengerRun } from "@orchestra/messenger";
import { z } from "zod";
import { createEngine } from "../src/engine.js";
import { commandPasses, noPattern } from "../src/gates/index.js";
import { defineRecipe } from "../src/recipe.js";
import type { EngineEvent } from "../src/types.js";

const exec = promisify(execFile);
const git = (cwd: string, args: string[]) => exec("git", args, { cwd });

async function makeScratchRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "orca-gates-"));
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "test@orca.dev"]);
  await git(dir, ["config", "user.name", "Orca Test"]);
  await writeFile(path.join(dir, "index.ts"), "export const answer = 'wrong';\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

/** Build a Messenger from a per-call handler that edits the worktree. */
function scriptedMessenger(
  handler: (req: { prompt: string; cwd?: string | undefined }) => Promise<void>,
): Messenger {
  return {
    send(req): MessengerRun {
      const work = (async (): Promise<DoneEvent> => {
        await handler({ prompt: req.prompt, cwd: req.cwd });
        return { type: "done", ok: true, costUsd: 0.01, turns: 1 };
      })();
      async function* events(): AsyncGenerator<MessengerEvent> {
        yield await work;
      }
      return { events: events(), done: work };
    },
  };
}

const write = (cwd: string | undefined, name: string, body: string) =>
  writeFile(path.join(cwd ?? ".", name), body);

async function drain(events: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const seen: EngineEvent[] = [];
  for await (const e of events) seen.push(e);
  return seen;
}

let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures++;
};

// ── Case 1: commandPasses passes when the worker creates the file ──────────────
{
  const repo = await makeScratchRepo();
  const recipe = defineRecipe({
    name: "make-file",
    description: "",
    input: z.object({}),
    async plan() {
      return [{ id: "t", goal: "create fixed.txt", dependsOn: [], context: {} }];
    },
    worker: () => ({ prompt: "do it", tools: ["Edit"], maxTurns: 3 }),
    gates: [commandPasses("test -f fixed.txt")],
    async finish(results) {
      return { ok: results.every((r) => r.ok) };
    },
  });
  const engine = createEngine({
    repo,
    messenger: scriptedMessenger((req) => write(req.cwd, "fixed.txt", "done\n")),
    recipes: { r: recipe },
  });
  const run = engine.start("r", {});
  const events = await drain(run.events);
  const result = await run.done;
  check(
    "case 1: commandPasses → completed on attempt 1",
    result.ok &&
      result.status === "completed" &&
      result.tasks[0]?.attempts === 1 &&
      events.some((e) => e.type === "gate.passed" && e.gate === "commandPasses"),
  );
}

// ── Case 2: @ts-expect-error rejected, retry sees the reason and succeeds ────────────
{
  const repo = await makeScratchRepo();
  let attempt2Prompt = "";
  const recipe = defineRecipe({
    name: "no-cheat",
    description: "",
    input: z.object({}),
    async plan() {
      return [{ id: "t", goal: "fix it", dependsOn: [], context: {} }];
    },
    worker: () => ({ prompt: "fix the file", tools: ["Edit"], maxTurns: 3 }),
    gates: [noPattern([/@ts-ignore/])],
    async finish(results) {
      return { ok: results.every((r) => r.ok) };
    },
  });
  // First attempt cheats with @ts-expect-error; once the rejection reason shows up in
  // the prompt, write a clean version.
  const messenger = scriptedMessenger(async (req) => {
    const cheated = req.prompt.includes("previous attempt was rejected");
    if (cheated) attempt2Prompt = req.prompt;
    await write(
      req.cwd,
      "index.ts",
      cheated ? "export const answer = 42;\n" : "// @ts-ignore\nexport const answer = 42;\n",
    );
  });
  const engine = createEngine({ repo, messenger, recipes: { r: recipe } });
  const run = engine.start("r", {});
  const events = await drain(run.events);
  const result = await run.done;
  check(
    "case 2: rejected on attempt 1, passes on attempt 2",
    result.ok && result.tasks[0]?.attempts === 2,
  );
  check(
    "case 2: attempt 2's prompt carries the @ts-ignore rejection reason",
    /@ts-ignore/.test(attempt2Prompt) && attempt2Prompt.includes("rejected"),
  );
  check(
    "case 2: emitted a task.retrying event",
    events.some((e) => e.type === "task.retrying"),
  );
}

// ── Case 3: impossible gate → 3 attempts → failed with reasons ─────────────────
{
  const repo = await makeScratchRepo();
  const recipe = defineRecipe({
    name: "impossible",
    description: "",
    input: z.object({}),
    async plan() {
      return [{ id: "t", goal: "never passes", dependsOn: [], context: {} }];
    },
    worker: () => ({ prompt: "try", tools: ["Edit"], maxTurns: 3 }),
    gates: [commandPasses("exit 1")], // can never pass
    async finish(results) {
      return { ok: results.every((r) => r.ok) };
    },
  });
  const engine = createEngine({
    repo,
    messenger: scriptedMessenger((req) => write(req.cwd, "x.txt", "noop\n")),
    recipes: { r: recipe },
    limits: { maxAttempts: 3 },
  });
  const run = engine.start("r", {});
  const events = await drain(run.events);
  const result = await run.done;
  const retries = events.filter((e) => e.type === "task.retrying").length;
  check(
    // The only task fails, so the whole run is "failed" (Phase 3 status semantics).
    "case 3: 3 attempts, 2 retries, then failed with reasons",
    !result.ok &&
      result.status === "failed" &&
      result.tasks[0]?.attempts === 3 &&
      retries === 2 &&
      (result.tasks[0]?.failures?.length ?? 0) > 0 &&
      events.some((e) => e.type === "task.failed"),
  );
}

console.log(
  failures === 0 ? "\n✅ Phase 2 gates + retry all pass." : `\n❌ ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
