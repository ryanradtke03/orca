import { describe, expect, it } from "vitest";
import { type ScheduleCtx, schedule, validateGraph } from "../src/scheduler.js";
import type { Budget, EngineEvent, Task, TaskResult } from "../src/types.js";

const task = (id: string, dependsOn: string[] = []): Task => ({
  id,
  goal: id,
  dependsOn,
  context: {},
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const noBudget: Budget = { add() {}, costUsed: () => 0, elapsedMs: () => 0, exceeded: () => null };

function fakeCtx(maxWorkers: number, emit: (e: EngineEvent) => void = () => {}): ScheduleCtx {
  return { limits: { maxWorkers }, signal: { aborted: false }, budget: noBudget, emit };
}

function runner(opts: { failIds?: Set<string>; delayMs?: number } = {}) {
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const runOne = async (t: Task): Promise<TaskResult> => {
    active++;
    maxActive = Math.max(maxActive, active);
    order.push(`start:${t.id}`);
    await sleep(opts.delayMs ?? 5);
    order.push(`end:${t.id}`);
    active--;
    const ok = !opts.failIds?.has(t.id);
    return { task: t, ok, attempts: 1, costUsd: 0, ...(ok ? {} : { failures: ["boom"] }) };
  };
  return { runOne, order: () => order, maxActive: () => maxActive };
}

describe("validateGraph", () => {
  it("passes a DAG", () => {
    expect(validateGraph([task("a"), task("b", ["a"])])).toBeNull();
  });
  it("catches cycles", () => {
    expect(validateGraph([task("a", ["b"]), task("b", ["a"])])).toContain("cycle");
  });
  it("catches unknown dependencies", () => {
    expect(validateGraph([task("a", ["ghost"])])).toContain("unknown");
  });
  it("catches duplicate ids", () => {
    expect(validateGraph([task("a"), task("a")])).toContain("duplicate");
  });
});

describe("schedule", () => {
  it("runs a diamond: A/B in parallel, C after both, D after C", async () => {
    const tasks = [task("A"), task("B"), task("C", ["A", "B"]), task("D", ["C"])];
    const r = runner({ delayMs: 15 });
    const { results, stopped } = await schedule(tasks, r.runOne, fakeCtx(2));
    const o = r.order();
    const i = (s: string) => o.indexOf(s);

    expect(stopped).toBeNull();
    expect(results.every((x) => x.ok)).toBe(true);
    // A and B overlap
    expect(i("start:A")).toBeLessThan(i("end:B"));
    expect(i("start:B")).toBeLessThan(i("end:A"));
    // C waits for both, D waits for C
    expect(i("start:C")).toBeGreaterThan(Math.max(i("end:A"), i("end:B")));
    expect(i("start:D")).toBeGreaterThan(i("end:C"));
  });

  it("skips dependents of a failed task, transitively", async () => {
    const tasks = [task("A"), task("B", ["A"]), task("C", ["B"]), task("D")];
    const events: EngineEvent[] = [];
    const r = runner({ failIds: new Set(["A"]) });
    const { results } = await schedule(
      tasks,
      r.runOne,
      fakeCtx(2, (e) => events.push(e)),
    );
    const byId = new Map(results.map((x) => [x.task.id, x.ok]));
    const skipped = events.filter((e) => e.type === "task.skipped").map((e) => e.taskId);

    expect(byId.get("A")).toBe(false);
    expect(byId.get("B")).toBe(false);
    expect(byId.get("C")).toBe(false);
    expect(byId.get("D")).toBe(true);
    expect(skipped).toEqual(expect.arrayContaining(["B", "C"]));
    expect(skipped).not.toContain("D");
  });

  it("never runs more than maxWorkers at once", async () => {
    const tasks = [task("A"), task("B"), task("C"), task("D"), task("E")];
    const r = runner({ delayMs: 15 });
    await schedule(tasks, r.runOne, fakeCtx(2));
    expect(r.maxActive()).toBe(2);
  });
});
