// packages/engine/src/types.ts
import type { Messenger, MessengerEvent } from "@orchestra/messenger";
import type { z } from "zod";

// ── Limits & config ───────────────────────────────────────────
export interface EngineLimits {
  maxWorkers: number; // tasks running at the same time
  maxAttempts: number; // worker attempts per task before giving up
  maxCostUsd: number; // per run; the run stops when reached
  maxDurationMs: number; // per run
}

export type KeepWorktrees = "always" | "on-failure" | "never";

export interface EngineConfig {
  repo: string; // git repo the engine works on
  messenger: Messenger; // any Messenger (CLI, fake, later SDK)
  recipes: Record<string, AnyRecipe>; // name → recipe registry
  limits?: Partial<EngineLimits> | undefined;
  worktreeDir?: string | undefined; // where task worktrees go (gitignored)
  traceDir?: string | undefined; // events + messenger traces per run
  keepWorktrees?: KeepWorktrees | undefined;
}

export interface StartOptions {
  signal?: AbortSignal | undefined;
  approvePlan?: boolean | undefined;
  limits?: Partial<EngineLimits> | undefined;
}

// ── The recipe contract ───────────────────────────────────────
export interface Task {
  id: string;
  goal: string;
  dependsOn: string[];
  context: Record<string, unknown>;
}

export interface WorkerConfig {
  prompt: string;
  tools: string[];
  allowEdits?: string[] | undefined; // path globs; enforced by the onlyTouches gate (Phase 3)
  maxTurns?: number | undefined;
  model?: string | undefined;
  system?: string | undefined;
}

export interface GateContext {
  worktree: string;
  task: Task;
  diff: string;
  changedFiles: string[];
  exec(
    cmd: string,
    opts?: { timeoutMs?: number | undefined },
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

export type GateResult = { ok: true } | { ok: false; reasons: string[] };

export interface Gate {
  name: string;
  check(ctx: GateContext): Promise<GateResult>;
}

/** Passed to recipe hooks. The engine owns everything; the recipe only decides. */
export interface Ctx {
  repo: string;
  messenger: Messenger; // recipes use askJson here for planner / triage agents
  signal: AbortSignal;
  emit(event: EngineEvent): void;
}

export interface Recipe<Input, Output = unknown> {
  name: string;
  description: string;
  input: z.ZodType<Input>; // validated before anything runs (Phase 3)

  plan(input: Input, ctx: Ctx): Promise<Task[]>;
  worker(task: Task, ctx: Ctx): WorkerConfig;
  gates: Gate[];
  onFailed?(task: Task, reasons: string[], ctx: Ctx): Promise<void>;
  finish(results: TaskResult[], ctx: Ctx): Promise<Output>;
}

// biome-ignore lint/suspicious/noExplicitAny: the registry holds recipes with differing input types
export type AnyRecipe = Recipe<any, any>;

// ── Results ───────────────────────────────────────────────────
/** The full result of a single task, handed to recipe.finish(). */
export interface TaskResult {
  task: Task;
  ok: boolean;
  attempts: number;
  costUsd: number;
  diff?: string | undefined;
  worktree?: string | undefined;
  failures?: string[] | undefined;
}

export type RunErrorKind =
  | "invalid_input"
  | "unknown_recipe"
  | "plan_failed"
  | "budget"
  | "timeout"
  | "cancelled";

export interface RunResultTask {
  id: string;
  ok: boolean;
  attempts: number;
  costUsd: number;
  diff?: string | undefined;
  failures?: string[] | undefined;
}

export interface RunResult {
  ok: boolean;
  status: "completed" | "partial" | "failed" | "cancelled";
  output?: unknown;
  tasks: RunResultTask[];
  costUsd: number;
  durationMs: number;
  tracePath: string;
  error?: { kind: RunErrorKind; message: string } | undefined;
}

// ── Events ────────────────────────────────────────────────────
// Later phases add plan.ready, approval.needed, budget.warning, etc.
export type EngineEvent =
  | { type: "run.started"; recipe: string; input: unknown }
  | { type: "task.started"; taskId: string; attempt: number; worktree: string }
  | { type: "worker.event"; taskId: string; event: MessengerEvent }
  | { type: "gate.passed"; taskId: string; gate: string }
  | { type: "gate.failed"; taskId: string; gate: string; reasons: string[] }
  | { type: "task.retrying"; taskId: string; attempt: number; reasons: string[] }
  | { type: "task.done"; taskId: string; attempts: number; costUsd: number }
  | { type: "task.failed"; taskId: string; reasons: string[] }
  | { type: "run.done"; result: RunResult };

// ── Public surface ────────────────────────────────────────────
export interface EngineRun {
  id: string; // run id, also the trace folder name
  events: AsyncIterable<EngineEvent>;
  done: Promise<RunResult>; // always resolves, never throws
  cancel(): void;
  approve(ok: boolean): void; // answers an approval.needed event (Phase 4)
}

export interface Engine {
  start(name: string, input: unknown, opts?: StartOptions): EngineRun;
}

// ── Internal run context, threaded through the lifecycle ───────
export interface RunCtx extends Ctx {
  runId: string;
  limits: EngineLimits;
}
