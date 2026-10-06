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
  output: string; // the worker's final message, for read-only recipes that gate on it
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
  /**
   * Run a command in the repo root (combined stdout+stderr), e.g. so plan() can
   * check whether there's anything to do. Gates get a richer exec on GateContext.
   */
  exec(
    cmd: string,
    opts?: { timeoutMs?: number | undefined },
  ): Promise<{ code: number; output: string }>;
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
  output?: string | undefined; // the worker's final message on the accepted/last attempt
  worktree?: string | undefined;
  failures?: string[] | undefined;
}

export type RunErrorKind =
  | "invalid_input"
  | "unknown_recipe"
  | "plan_failed"
  | "finish_failed"
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

/** A past run, read back from its trace folder (engine.runs()). */
export interface RunSummary {
  id: string;
  finishedAt: string;
  status: RunResult["status"];
  ok: boolean;
  costUsd: number;
  durationMs: number;
  tracePath: string;
}

/** A recipe's public description, for CLI help and the Electron form (engine.recipes()). */
export interface RecipeInfo {
  name: string;
  description: string;
  inputSchema: unknown; // JSON schema, from the recipe's Zod input
}

// ── Events ────────────────────────────────────────────────────
export interface PlanTask {
  id: string;
  goal: string;
  dependsOn: string[];
}

export type EngineEvent =
  | { type: "run.started"; recipe: string; input: unknown }
  | { type: "plan.ready"; tasks: PlanTask[] }
  | { type: "approval.needed"; what: string }
  | { type: "task.started"; taskId: string; attempt: number; worktree: string }
  | { type: "worker.event"; taskId: string; event: MessengerEvent }
  | { type: "gate.passed"; taskId: string; gate: string }
  | { type: "gate.failed"; taskId: string; gate: string; reasons: string[] }
  | { type: "task.retrying"; taskId: string; attempt: number; reasons: string[] }
  | { type: "task.done"; taskId: string; attempts: number; costUsd: number }
  | { type: "task.failed"; taskId: string; reasons: string[] }
  | { type: "task.skipped"; taskId: string; reason: string }
  | { type: "budget.warning"; resource: "cost" | "duration"; used: number; limit: number }
  | { type: "run.done"; result: RunResult };

// Tracks a run's cost and duration against the limits (design §12, budget.ts).
export interface Budget {
  add(costUsd: number): void;
  costUsed(): number;
  elapsedMs(): number;
  /** The kind of cap that's been hit, or null if there's still room. */
  exceeded(): "budget" | "timeout" | null;
}

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
  recipes(): RecipeInfo[]; // name, description, input schema of each recipe
  runs(): Promise<RunSummary[]>; // past runs, from the trace folder
  get(runId: string): EngineRun | undefined; // a run still in progress (reattach)
}

// ── Internal run context, threaded through the lifecycle ───────
export interface RunCtx extends Ctx {
  runId: string;
  limits: EngineLimits;
  budget: Budget;
  keepWorktrees: KeepWorktrees;
  worktreeDir?: string | undefined;
  approvePlan: boolean;
  waitApproval(): Promise<boolean>;
}
