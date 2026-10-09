import type { EngineEvent, RunResult } from "@orchestra/engine";
import { describe, expect, it } from "vitest";
import { formatEvent } from "../src/events.js";

const okResult: RunResult = {
  ok: true,
  status: "completed",
  tasks: [],
  costUsd: 0.25,
  durationMs: 1000,
  tracePath: "/t",
};

describe("formatEvent", () => {
  it("renders task and gate events with indentation", () => {
    expect(formatEvent({ type: "task.started", taskId: "t1", attempt: 1, worktree: "/w" })).toBe(
      "  ▶ t1 (attempt 1)",
    );
    expect(formatEvent({ type: "gate.passed", taskId: "t1", gate: "tests" })).toBe("    ✓ tests");
    expect(
      formatEvent({ type: "gate.failed", taskId: "t1", gate: "tests", reasons: ["boom\nmore"] }),
    ).toBe("    ✗ tests: boom"); // only the first line of the first reason
    expect(formatEvent({ type: "task.done", taskId: "t1", attempts: 2, costUsd: 0.5 })).toBe(
      "  ✓ t1 — 2 attempt(s), $0.500",
    );
  });

  it("renders chain step and child events", () => {
    expect(formatEvent({ type: "step.started", name: "repro" })).toBe("→ repro");
    expect(formatEvent({ type: "child.started", childRunId: "c1", recipe: "fix-ci" })).toBe(
      "  ↳ fix-ci",
    );
    expect(
      formatEvent({ type: "child.done", childRunId: "c1", recipe: "fix-ci", result: okResult }),
    ).toBe("  ✓ fix-ci — completed, $0.250");
  });

  it("shows tool calls always but message text only when verbose", () => {
    const toolEvent: EngineEvent = {
      type: "worker.event",
      taskId: "t1",
      event: { type: "tool_use", id: "x", name: "Bash", input: {} },
    };
    expect(formatEvent(toolEvent)).toBe("      · Bash");

    const msgEvent: EngineEvent = {
      type: "worker.event",
      taskId: "t1",
      event: { type: "message", text: "thinking   hard" },
    };
    expect(formatEvent(msgEvent)).toBeNull(); // not verbose
    expect(formatEvent(msgEvent, { verbose: true })).toBe("      “thinking hard”");
  });

  it("indents a child's nested events one level deeper", () => {
    const nested: EngineEvent = {
      type: "child.event",
      childRunId: "c1",
      recipe: "fix-ci",
      event: { type: "task.done", taskId: "t1", attempts: 1, costUsd: 0.1 },
    };
    expect(formatEvent(nested)).toBe("    ✓ t1 — 1 attempt(s), $0.100"); // extra 2-space indent
  });

  it("suppresses the terminal run.done/step.done events (command prints the result)", () => {
    expect(formatEvent({ type: "run.done", result: okResult })).toBeNull();
    expect(formatEvent({ type: "step.done", name: "repro" })).toBeNull();
  });
});
