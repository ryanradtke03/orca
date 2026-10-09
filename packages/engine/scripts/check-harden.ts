// Deterministic Phase 3 check — validation, budget, cancel, status, new gates.
//
//   pnpm --filter @orchestra/engine exec tsx scripts/check-harden.ts
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { DoneEvent, Messenger, MessengerEvent, MessengerRun } from "@orchestra/messenger";
import { z } from "zod";
import { createEngine } from "../src/engine.js";
import { filesExist, onlyTouches } from "../src/gates/index.js";
import { defineRecipe } from "../src/recipe.js";
import type { EngineEvent } from "../src/types.js";

const exec = promisify(execFile);
const git = (cwd: string, args: string[]) => exec("git", args, { cwd });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeScratchRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "orca-harden-"));
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "test@orca.dev"]);
  await git(dir, ["config", "user.name", "Orca Test"]);
  await writeFile(path.join(dir, "index.ts"), "export const x = 1;\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

interface Scripted extends Messenger {
  calls: number;
}
function scriptedMessenger(
  handler: (req: { prompt: string; cwd?: string | undefined }) => Promise<void>,
  opts: { delayMs?: number; costUsd?: number } = {},
): Scripted {
  const m: Scripted = {
    calls: 0,
    send(req): MessengerRun {
      m.calls++;
      const work = (async (): Promise<DoneEvent> => {
        if (opts.delayMs) await sleep(opts.delayMs);
        await handler({ prompt: req.prompt, cwd: req.cwd });
        return { type: "done", ok: true, costUsd: opts.costUsd ?? 0.001, turns: 1 };
      })();
      async function* events(): AsyncGenerator<MessengerEvent> {
        yield await work;
      }
      return { events: events(), done: work };
    },
  };
  return m;
}

const write = (cwd: string | undefined, name: string, body: string) =>
  writeFile(path.join(cwd ?? ".", name), body);

async function drain(events: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const seen: EngineEvent[] = [];
  for await (const e of events) seen.push(e);
  return seen;
}

async function orcaWorktrees(repo: string): Promise<string[]> {
  const { stdout } = await git(repo, ["worktree", "list", "--porcelain"]);
  return stdout
    .split("\n")
    .filter((l) => l.startsWith("worktree ") && l.includes(".orca"))
    .map((l) => l.slice("worktree ".length));
}

let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures++;
};

// ── Case 1: bad input → invalid_input, nothing spawned ─────────────────────────
{
  const repo = await makeScratchRepo();
  const messenger = scriptedMessenger((req) => write(req.cwd, "x", "x"));
  const recipe = defineRecipe({
    name: "typed",
    description: "",
    input: z.object({ command: z.string() }),
    async plan(input) {
      return [{ id: "t", goal: input.command, dependsOn: [], context: {} }];
    },
    worker: () => ({ prompt: "p", tools: [], maxTurns: 1 }),
    gates: [],
    async finish() {
      return {};
    },
  });
  const engine = createEngine({ repo, messenger, recipes: { r: recipe } });
  // command should be a string; pass a number
  const run = engine.start("r", { command: 123 });
  await drain(run.events);
  const result = await run.done;
  check(
    "case 1: invalid input → invalid_input, no worker spawned",
    result.status === "failed" && result.error?.kind === "invalid_input" && messenger.calls === 0,
  );
}

// ── Case 2: unknown recipe → unknown_recipe ────────────────────────────────────
{
  const repo = await makeScratchRepo();
  const engine = createEngine({
    repo,
    messenger: scriptedMessenger((req) => write(req.cwd, "x", "x")),
    recipes: {},
  });
  const run = engine.start("nope", {});
  await drain(run.events);
  const result = await run.done;
  check("case 2: unknown recipe → unknown_recipe", result.error?.kind === "unknown_recipe");
}

// ── Case 3: cost cap → partial / budget, with a budget.warning ─────────────────
{
  const repo = await makeScratchRepo();
  const recipe = defineRecipe({
    name: "two-tasks",
    description: "",
    input: z.object({}),
    async plan() {
      // b depends on a, so the cap is re-checked after a finishes and b never starts.
      return [
        { id: "a", goal: "a", dependsOn: [], context: {} },
        { id: "b", goal: "b", dependsOn: ["a"], context: {} },
      ];
    },
    worker: () => ({ prompt: "p", tools: ["Edit"], maxTurns: 1 }),
    gates: [],
    async finish() {
      return {};
    },
  });
  const engine = createEngine({
    repo,
    messenger: scriptedMessenger((req) => write(req.cwd, "f.txt", "x"), { costUsd: 0.01 }),
    recipes: { r: recipe },
    limits: { maxCostUsd: 0.01 },
  });
  const run = engine.start("r", {});
  const events = await drain(run.events);
  const result = await run.done;
  check(
    "case 3: cost cap → partial / budget after first task only",
    result.status === "partial" &&
      result.error?.kind === "budget" &&
      result.tasks.length === 1 &&
      events.some((e) => e.type === "budget.warning" && e.resource === "cost"),
  );
}

// ── Case 4: cancel mid-run → cancelled, worktrees cleaned up ───────────────────
{
  const repo = await makeScratchRepo();
  const recipe = defineRecipe({
    name: "slow",
    description: "",
    input: z.object({}),
    async plan() {
      return [
        { id: "a", goal: "a", dependsOn: [], context: {} },
        { id: "b", goal: "b", dependsOn: [], context: {} },
      ];
    },
    worker: () => ({ prompt: "p", tools: ["Edit"], maxTurns: 1 }),
    gates: [],
    async finish() {
      return {};
    },
  });
  const engine = createEngine({
    repo,
    messenger: scriptedMessenger((req) => write(req.cwd, "f.txt", "x"), { delayMs: 60 }),
    recipes: { r: recipe },
  });
  const run = engine.start("r", {});
  const drained = drain(run.events);
  await sleep(15);
  run.cancel();
  const result = await run.done;
  await drained;
  const leftover = await orcaWorktrees(repo);
  check(
    "case 4: cancel mid-run → cancelled, worktrees cleaned up",
    result.status === "cancelled" && result.error?.kind === "cancelled" && leftover.length === 0,
  );
}

// ── Case 5: finish() throws → failed / finish_failed ───────────────────────────
{
  const repo = await makeScratchRepo();
  const recipe = defineRecipe({
    name: "bad-finish",
    description: "",
    input: z.object({}),
    async plan() {
      return [{ id: "t", goal: "t", dependsOn: [], context: {} }];
    },
    worker: () => ({ prompt: "p", tools: ["Edit"], maxTurns: 1 }),
    gates: [],
    async finish() {
      throw new Error("boom");
    },
  });
  const engine = createEngine({
    repo,
    messenger: scriptedMessenger((req) => write(req.cwd, "f.txt", "x")),
    recipes: { r: recipe },
  });
  const run = engine.start("r", {});
  await drain(run.events);
  const result = await run.done;
  check(
    "case 5: finish() throws → failed / finish_failed",
    result.status === "failed" &&
      result.error?.kind === "finish_failed" &&
      result.error?.message === "boom",
  );
}

// ── Case 6: onlyTouches + filesExist gates ─────────────────────────────────────
{
  const repo = await makeScratchRepo();
  const recipe = defineRecipe({
    name: "scoped",
    description: "",
    input: z.object({ good: z.boolean() }),
    async plan(input) {
      return [{ id: "t", goal: "t", dependsOn: [], context: input }];
    },
    worker: () => ({ prompt: "p", tools: ["Edit"], maxTurns: 1 }),
    gates: [onlyTouches(["allowed.txt"]), filesExist(["allowed.txt"])],
    async finish(results) {
      return { ok: results.every((r) => r.ok) };
    },
  });
  // Passing case: worker writes exactly allowed.txt.
  {
    const engine = createEngine({
      repo,
      messenger: scriptedMessenger((req) => write(req.cwd, "allowed.txt", "ok")),
      recipes: { r: recipe },
      limits: { maxAttempts: 1 },
    });
    const result = await drainDone(engine.start("r", { good: true }));
    check("case 6a: onlyTouches + filesExist pass when only allowed.txt changes", result.ok);
  }
  // Failing case: worker writes a file outside the allow-list.
  {
    const engine = createEngine({
      repo,
      messenger: scriptedMessenger((req) => write(req.cwd, "other.txt", "nope")),
      recipes: { r: recipe },
      limits: { maxAttempts: 1 },
    });
    const result = await drainDone(engine.start("r", { good: false }));
    const reasons = result.tasks[0]?.failures ?? [];
    check(
      "case 6b: rejected when a file outside the allow-list changes",
      !result.ok &&
        reasons.some((r) => r.includes("outside the allowed paths")) &&
        reasons.some((r) => r.includes("does not exist")),
    );
  }
}

async function drainDone(run: ReturnType<ReturnType<typeof createEngine>["start"]>) {
  await drain(run.events);
  return run.done;
}

console.log(
  failures === 0 ? "\n✅ Phase 3 hardening all pass." : `\n❌ ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
