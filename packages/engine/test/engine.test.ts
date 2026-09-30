import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createEngine } from "../src/engine.js";
import { defineRecipe } from "../src/recipe.js";
import type { EngineEvent } from "../src/types.js";
import { cleanup, drain, makeScratchRepo, runToEnd, scriptedMessenger, write } from "./helpers.js";

const writesFile = () => scriptedMessenger((req) => write(req.cwd, "out.txt", "done\n"));

const oneTask = defineRecipe({
  name: "one",
  description: "a one-task recipe",
  input: z.object({ label: z.string().default("x") }),
  async plan() {
    return [{ id: "t", goal: "t", dependsOn: [], context: {} }];
  },
  worker: () => ({ prompt: "p", tools: ["Edit"], maxTurns: 1 }),
  gates: [],
  async finish(results) {
    return { ok: results.every((r) => r.ok) };
  },
});

describe("engine — validation & status", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo();
  });
  afterEach(() => cleanup(repo));

  it("rejects bad input without spawning a worker", async () => {
    const typed = defineRecipe({
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
    const messenger = writesFile();
    const engine = createEngine({ repo, messenger, recipes: { typed } });
    const { result } = await runToEnd(engine.start("typed", { command: 123 }));
    expect(result.status).toBe("failed");
    expect(result.error?.kind).toBe("invalid_input");
    expect(messenger.calls).toHaveLength(0);
  });

  it("reports unknown_recipe", async () => {
    const engine = createEngine({ repo, messenger: writesFile(), recipes: {} });
    const { result } = await runToEnd(engine.start("ghost", {}));
    expect(result.error?.kind).toBe("unknown_recipe");
  });

  it("completes a valid run", async () => {
    const engine = createEngine({ repo, messenger: writesFile(), recipes: { one: oneTask } });
    const { result } = await runToEnd(engine.start("one", {}));
    expect(result.status).toBe("completed");
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ ok: true });
  });

  it("surfaces a finish() failure as finish_failed", async () => {
    const badFinish = defineRecipe({
      name: "bad",
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
    const engine = createEngine({ repo, messenger: writesFile(), recipes: { bad: badFinish } });
    const { result } = await runToEnd(engine.start("bad", {}));
    expect(result.status).toBe("failed");
    expect(result.error).toEqual({ kind: "finish_failed", message: "boom" });
  });
});

describe("engine — budget & cancel", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo();
  });
  afterEach(() => cleanup(repo));

  it("stops at the cost cap as partial/budget", async () => {
    const twoTasks = defineRecipe({
      name: "two",
      description: "",
      input: z.object({}),
      async plan() {
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
    const messenger = scriptedMessenger((req) => write(req.cwd, "f.txt", "x"));
    // each worker call costs the default 0.001; cap at 0.001 trips after task a
    const engine = createEngine({
      repo,
      messenger,
      recipes: { two: twoTasks },
      limits: { maxCostUsd: 0.001 },
    });
    const { events, result } = await runToEnd(engine.start("two", {}));
    expect(result.status).toBe("partial");
    expect(result.error?.kind).toBe("budget");
    expect(result.tasks).toHaveLength(1);
    expect(events.some((e) => e.type === "budget.warning")).toBe(true);
  });

  it("cancels mid-run and cleans up worktrees", async () => {
    const messenger = scriptedMessenger((req) => write(req.cwd, "f.txt", "x"), { delayMs: 50 });
    const engine = createEngine({ repo, messenger, recipes: { one: oneTask } });
    const run = engine.start("one", {});
    const drained = drain(run.events);
    await new Promise((r) => setTimeout(r, 10));
    run.cancel();
    const result = await run.done;
    await drained;

    expect(result.status).toBe("cancelled");
    expect(result.error?.kind).toBe("cancelled");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { stdout } = await promisify(execFile)("git", ["worktree", "list"], { cwd: repo });
    expect(stdout).not.toContain(".orchestra");
  });
});

describe("engine — approval", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo();
  });
  afterEach(() => cleanup(repo));

  async function decide(ok: boolean) {
    const engine = createEngine({ repo, messenger: writesFile(), recipes: { one: oneTask } });
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

  it("cancels when the plan is rejected, before any worker runs", async () => {
    const { result, seen } = await decide(false);
    expect(result.status).toBe("cancelled");
    expect(seen.some((e) => e.type === "plan.ready")).toBe(true);
    expect(seen.some((e) => e.type === "task.started")).toBe(false);
  });

  it("proceeds when the plan is approved", async () => {
    const { result, seen } = await decide(true);
    expect(result.status).toBe("completed");
    expect(seen.some((e) => e.type === "task.started")).toBe(true);
  });
});

describe("engine — tooling (traces, recipes, runs, get)", () => {
  let repo: string;
  let traceDir: string;
  beforeEach(async () => {
    repo = await makeScratchRepo();
    traceDir = await mkdtemp(path.join(tmpdir(), "orca-traces-"));
  });
  afterEach(async () => {
    await cleanup(repo);
    await cleanup(traceDir);
  });

  it("writes events.jsonl + summary.json and lists the run", async () => {
    const engine = createEngine({
      repo,
      messenger: writesFile(),
      recipes: { one: oneTask },
      traceDir,
    });
    const run = engine.start("one", {});
    const result = await run.done;
    await drain(run.events);

    expect(result.tracePath).toContain(run.id);
    const events = await readFile(path.join(result.tracePath, "events.jsonl"), "utf8");
    expect(events).toContain('"run.started"');
    expect(events).toContain('"run.done"');
    const summary = JSON.parse(await readFile(path.join(result.tracePath, "summary.json"), "utf8"));
    expect(summary.id).toBe(run.id);
    expect(summary.result.status).toBe("completed");

    const runs = await engine.runs();
    expect(runs.map((r) => r.id)).toContain(run.id);
    expect(runs[0]?.status).toBe("completed");
  });

  it("recipes() reports name, description and a JSON schema", () => {
    const engine = createEngine({ repo, messenger: writesFile(), recipes: { one: oneTask } });
    const infos = engine.recipes();
    expect(infos).toHaveLength(1);
    expect(infos[0]?.name).toBe("one");
    expect(infos[0]?.description).toBe("a one-task recipe");
    expect(JSON.stringify(infos[0]?.inputSchema)).toContain("label");
  });

  it("get() returns a live run and drops it once done", async () => {
    const messenger = scriptedMessenger((req) => write(req.cwd, "f.txt", "x"), { delayMs: 30 });
    const engine = createEngine({ repo, messenger, recipes: { one: oneTask } });
    const run = engine.start("one", {});
    expect(engine.get(run.id)).toBe(run);
    await run.done;
    await drain(run.events);
    expect(engine.get(run.id)).toBeUndefined();
  });
});
