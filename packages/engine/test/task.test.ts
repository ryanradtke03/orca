import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { commandPasses } from "../src/gates/index.js";
import { runTask } from "../src/task.js";
import type { AnyRecipe, EngineEvent, Task } from "../src/types.js";
import { cleanup, makeRunCtx, makeScratchRepo, scriptedMessenger, write } from "./helpers.js";

const theTask: Task = { id: "fix", goal: "make ok.txt", dependsOn: [], context: {} };

function recipe(gates: AnyRecipe["gates"], onFailed?: AnyRecipe["onFailed"]): AnyRecipe {
  return {
    name: "t",
    description: "",
    input: z.object({}),
    async plan() {
      return [theTask];
    },
    worker: () => ({ prompt: "write the file", tools: ["Edit"], maxTurns: 1 }),
    gates,
    ...(onFailed ? { onFailed } : {}),
    async finish() {
      return {};
    },
  };
}

describe("runTask", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo();
  });
  afterEach(() => cleanup(repo));

  it("passes on the first attempt when the gate is satisfied", async () => {
    const messenger = scriptedMessenger((req) => write(req.cwd, "ok.txt", "x"));
    const ctx = makeRunCtx({ repo, messenger });
    const result = await runTask(theTask, recipe([commandPasses("test -f ok.txt")]), ctx);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.diff).toContain("ok.txt");
  });

  it("retries with the rejection reason and passes on attempt 2", async () => {
    // First attempt writes the wrong file; once the prompt carries the rejection, write ok.txt.
    const messenger = scriptedMessenger((req) => {
      const retry = req.prompt.includes("previous attempt was rejected");
      return write(req.cwd, retry ? "ok.txt" : "wrong.txt", "x");
    });
    const events: EngineEvent[] = [];
    const ctx = makeRunCtx({ repo, messenger, emit: (e) => events.push(e) });
    const result = await runTask(theTask, recipe([commandPasses("test -f ok.txt")]), ctx);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(messenger.calls[1]?.prompt).toContain("test -f ok.txt"); // the reason is fed back
    expect(events.some((e) => e.type === "task.retrying")).toBe(true);
  });

  it("gives up after maxAttempts and calls onFailed", async () => {
    let onFailedReasons: string[] | null = null;
    const messenger = scriptedMessenger((req) => write(req.cwd, "junk.txt", "x"));
    const events: EngineEvent[] = [];
    const ctx = makeRunCtx({
      repo,
      messenger,
      limits: { maxAttempts: 3 },
      emit: (e) => events.push(e),
    });
    const result = await runTask(
      theTask,
      recipe([commandPasses("exit 1")], async (_t, reasons) => {
        onFailedReasons = reasons;
      }),
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.failures?.length ?? 0).toBeGreaterThan(0);
    expect(onFailedReasons).not.toBeNull();
    expect(events.filter((e) => e.type === "task.retrying")).toHaveLength(2);
    expect(events.some((e) => e.type === "task.failed")).toBe(true);
  });
});
