// A single readable renderer for the engine's event stream, so every command — not
// just the hand-wired bug-to-pr script — gets the same streaming output. It
// consolidates two printers that lived in the recipe scripts: the task/gate/budget
// cases from scripts/scenarios.ts (printEvent) and the chain-level step/child cases
// from scripts/bug-to-pr.ts. Events are progress, so the stream goes to stderr; the
// final result is left for the command to print to stdout.
import type { EngineEvent } from "@orchestra/engine";

export interface FormatOptions {
  /** Also surface worker message text (otherwise only tool calls show). */
  verbose?: boolean | undefined;
}

function firstLine(s: string | undefined): string {
  return (s ?? "").split("\n")[0] ?? "";
}

function clip(s: string, max = 140): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * One display line for an event, or `null` for events not worth surfacing (the final
 * `run.done`/`step.done`, and non-tool worker chatter unless verbose). Indentation
 * encodes nesting: a chain's child-run events are indented one level under the chain.
 */
export function formatEvent(e: EngineEvent, opts: FormatOptions = {}): string | null {
  switch (e.type) {
    case "run.started":
      return `▶ ${e.recipe}`;
    case "plan.ready":
      return `  plan: ${e.tasks.length} task(s)`;
    case "approval.needed":
      return `  ⏸ approval needed: ${e.what}`;
    case "task.started":
      return `  ▶ ${e.taskId} (attempt ${e.attempt})`;
    case "gate.passed":
      return `    ✓ ${e.gate}`;
    case "gate.failed":
      return `    ✗ ${e.gate}: ${firstLine(e.reasons[0])}`;
    case "task.retrying":
      return `  ↻ retry ${e.taskId} — ${e.reasons.length} reason(s)`;
    case "task.done":
      return `  ✓ ${e.taskId} — ${e.attempts} attempt(s), $${e.costUsd.toFixed(3)}`;
    case "task.failed":
      return `  ✗ ${e.taskId} failed`;
    case "task.skipped":
      return `  ⃠ ${e.taskId} skipped: ${e.reason}`;
    case "budget.warning":
      return `  ! budget ${e.resource}: ${e.used} / ${e.limit}`;
    case "step.started":
      return `→ ${e.name}`;
    case "child.started":
      return `  ↳ ${e.recipe}`;
    case "child.done": {
      const tag = e.result.ok ? "✓" : "✗";
      return `  ${tag} ${e.recipe} — ${e.result.status}, $${e.result.costUsd.toFixed(3)}`;
    }
    case "worker.event": {
      const w = e.event;
      if (w.type === "tool_use") return `      · ${w.name}`;
      if (opts.verbose && w.type === "message") return `      “${clip(w.text)}”`;
      return null;
    }
    case "child.event": {
      const inner = formatEvent(e.event, opts);
      return inner === null ? null : `  ${inner}`; // nest the child's events under it
    }
    case "step.done":
    case "run.done":
      return null; // the command prints the final result to stdout, not the stream
    default: {
      const exhaustive: never = e;
      void exhaustive; // a new event type will fail to compile here until handled
      return null;
    }
  }
}

/** Drain a run's event stream to stderr, one formatted line at a time. */
export async function streamEvents(
  run: { events: AsyncIterable<EngineEvent> },
  opts: FormatOptions = {},
): Promise<void> {
  for await (const e of run.events) {
    const line = formatEvent(e, opts);
    if (line !== null) process.stderr.write(`${line}\n`);
  }
}
