// Deterministic Phase 4 check — scheduler (fake runOne, no git) + approval.
//
//   pnpm --filter @orchestra/engine exec tsx scripts/check-scheduler.ts
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { DoneEvent, Messenger, MessengerEvent, MessengerRun } from "@orchestra/messenger";
import { z } from "zod";
import { createEngine } from "../src/engine.js";
import { defineRecipe } from "../src/recipe.js";
import { type ScheduleCtx, schedule, validateGraph } from "../src/scheduler.js";
import type { Budget, EngineEvent, Task, TaskResult } from "../src/types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures++;
};

const task = (id: string, dependsOn: string[] = []): Task => ({
  id,
  goal: id,
  dependsOn,
  context: {},
});

const noBudget: Budget = {
  add() {},
  costUsed: () => 0,
  elapsedMs: () => 0,
  exceeded: () => null,
};

function fakeCtx(maxWorkers: number, emit: (e: EngineEvent) => void = () => {}): ScheduleCtx {
  return { limits: { maxWorkers }, signal: { aborted: false }, budget: noBudget, emit };
}

/** A fake worker that records concurrency and start/end order. */
function makeRunner(opts: { failIds?: Set<string>; delayMs?: number } = {}) {
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const runOne = async (t: Task): Promise<TaskResult> => {
    active++;
    maxActive = Math.max(maxActive, active);
    order.push(`start:${t.id}`);
    await sleep(opts.delayMs ?? 10);
    order.push(`end:${t.id}`);
    active--;
    const ok = !opts.failIds?.has(t.id);
    return { task: t, ok, attempts: 1, costUsd: 0, ...(ok ? {} : { failures: ["boom"] }) };
  };
  return { runOne, order: () => order, maxActive: () => maxActive };
}

const idx = (order: string[], entry: string) => order.indexOf(entry);

// ── Case 1: diamond — A,B parallel, C after both, D after C ─────────────────────
{
  const tasks = [task("A"), task("B"), task("C", ["A", "B"]), task("D", ["C"])];
  const r = makeRunner({ delayMs: 20 });
  const { results } = await schedule(tasks, r.runOne, fakeCtx(2));
  const o = r.order();
  const parallelAB = idx(o, "start:A") < idx(o, "end:B") && idx(o, "start:B") < idx(o, "end:A");
  const cAfterAB = idx(o, "start:C") > idx(o, "end:A") && idx(o, "start:C") > idx(o, "end:B");
  const dAfterC = idx(o, "start:D") > idx(o, "end:C");
  check(
    "case 1: diamond — A/B parallel, C after both, D after C",
    results.length === 4 && results.every((x) => x.ok) && parallelAB && cAfterAB && dAfterC,
  );
}

// ── Case 2: skip — A fails, its dependents are skipped ─────────────────────────
{
  const tasks = [task("A"), task("B", ["A"]), task("C", ["B"]), task("D")];
  const events: EngineEvent[] = [];
  const r = makeRunner({ failIds: new Set(["A"]) });
  const { results } = await schedule(
    tasks,
    r.runOne,
    fakeCtx(2, (e) => events.push(e)),
  );
  const byId = new Map(results.map((x) => [x.task.id, x]));
  const skipped = events.filter((e) => e.type === "task.skipped").map((e) => e.taskId);
  check(
    "case 2: A fails → B and C skipped, D still done",
    byId.get("A")?.ok === false &&
      byId.get("B")?.ok === false &&
      byId.get("C")?.ok === false &&
      byId.get("D")?.ok === true &&
      skipped.includes("B") &&
      skipped.includes("C") &&
      !skipped.includes("D"),
  );
}

// ── Case 3: cycle detection ────────────────────────────────────────────────────
{
  const cycle = validateGraph([task("A", ["B"]), task("B", ["A"])]);
  const unknown = validateGraph([task("A", ["ghost"])]);
  const ok = validateGraph([task("A"), task("B", ["A"])]);
  check(
    "case 3: validateGraph flags cycles and unknown deps, passes a DAG",
    !!cycle?.includes("cycle") && !!unknown?.includes("unknown") && ok === null,
  );
}

// ── Case 4: maxWorkers respected ───────────────────────────────────────────────
{
  const tasks = [task("A"), task("B"), task("C"), task("D")];
  const r = makeRunner({ delayMs: 20 });
  await schedule(tasks, r.runOne, fakeCtx(2));
  check("case 4: never more than maxWorkers (2) running at once", r.maxActive() === 2);
}

// ── Approval cases need a real engine (scratch repo + scripted messenger) ───────
async function makeScratchRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "orca-sched-"));
  const git = (args: string[]) => promisify(execFile)("git", args, { cwd: dir });
  await git(["init", "-q"]);
  await git(["config", "user.email", "test@orca.dev"]);
  await git(["config", "user.name", "Orca Test"]);
  await writeFile(path.join(dir, "seed.txt"), "seed\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "initial"]);
  return dir;
}

const scriptedMessenger: Messenger = {
  send(req): MessengerRun {
    const work = (async (): Promise<DoneEvent> => {
      await writeFile(path.join(req.cwd ?? ".", "out.txt"), "done\n");
      return { type: "done", ok: true, costUsd: 0.001, turns: 1 };
    })();
    async function* events(): AsyncGenerator<MessengerEvent> {
      yield await work;
    }
    return { events: events(), done: work };
  },
};

const oneTask = defineRecipe({
  name: "one",
  description: "",
  input: z.object({}),
  async plan() {
    return [{ id: "t", goal: "t", dependsOn: [], context: {} }];
  },
  worker: () => ({ prompt: "p", tools: ["Edit"], maxTurns: 1 }),
  gates: [],
  async finish(results) {
    return { ok: results.every((r) => r.ok) };
  },
});

// Drive an approval decision: answer the approval.needed event with `ok`.
async function runWithApproval(repo: string, ok: boolean) {
  const engine = createEngine({ repo, messenger: scriptedMessenger, recipes: { one: oneTask } });
  const run = engine.start("one", {}, { approvePlan: true });
  const seen: EngineEvent[] = [];
  const drained = (async () => {
    for await (const e of run.events) {
      seen.push(e);
      if (e.type === "approval.needed") run.approve(ok);
    }
  })();
  const result = await run.done;
  await drained;
  return { result, seen };
}

// ── Case 5: plan rejected → cancelled, no worker ran ───────────────────────────
{
  const repo = await makeScratchRepo();
  const { result, seen } = await runWithApproval(repo, false);
  check(
    "case 5: reject plan → cancelled, plan.ready emitted, no task ran",
    result.status === "cancelled" &&
      result.error?.kind === "cancelled" &&
      seen.some((e) => e.type === "plan.ready") &&
      !seen.some((e) => e.type === "task.started"),
  );
}

// ── Case 6: plan approved → run proceeds to completion ─────────────────────────
{
  const repo = await makeScratchRepo();
  const { result, seen } = await runWithApproval(repo, true);
  check(
    "case 6: approve plan → run completes",
    result.status === "completed" &&
      result.ok &&
      seen.some((e) => e.type === "approval.needed") &&
      seen.some((e) => e.type === "task.started"),
  );
}

console.log(
  failures === 0
    ? "\n✅ Phase 4 scheduler + approval all pass."
    : `\n❌ ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
