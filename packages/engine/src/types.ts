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
  recipes: Record<string, Registered>; // name → recipe or chain registry
  pr?: PrSink | undefined; // read issues / open PRs / comment (chains); omit outside chains
  limits?: Partial<EngineLimits> | undefined;
  worktreeDir?: string | undefined; // where task worktrees go (gitignored)
  traceDir?: string | undefined; // events + messenger traces per run
  keepWorktrees?: KeepWorktrees | undefined;
}

export interface StartOptions {
  signal?: AbortSignal | undefined;
  approvePlan?: boolean | undefined;
  limits?: Partial<EngineLimits> | undefined;
  base?: string | undefined; // a branch or commit to run against; default "HEAD"
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

// ── Composition: child runs, git, PR sink, chains ─────────────
export interface ChildRunOptions {
  base?: string | undefined; // the ref to run the child against; default "HEAD"
  limits?: Partial<EngineLimits> | undefined; // tighten the child's limits (capped by the parent)
}

/** Start another run from inside a chain. Never throws; a failed child is a RunResult. */
export type ChildRun = (name: string, input: unknown, opts?: ChildRunOptions) => Promise<RunResult>;

export interface GitCommitOptions {
  from?: string | undefined; // the ref a new branch is cut from; default "HEAD"
  diff: string; // a unified diff, applied with `git apply --index`
  message: string;
}

/** Commit diffs onto a branch through a throwaway worktree — your checkout never moves. */
export interface GitHelpers {
  commit(branch: string, opts: GitCommitOptions): Promise<string>; // returns the new commit sha
  push(branch: string): Promise<void>; // only orca/* branches
}

export interface PrOpenInput {
  branch: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
}

/** Read issues, open PRs and comment. A local file-backed version runs scenarios. */
export interface PrSink {
  readIssue(n: number): Promise<string>; // "title\n\nbody"
  open(pr: PrOpenInput): Promise<{ url: string }>;
  comment(issue: number, body: string): Promise<void>;
}

/** A chain sequences child runs and deterministic steps; no plan/worker/gates. */
export interface Chain<Input, Output = unknown> {
  kind: "chain";
  name: string;
  description: string;
  input: z.ZodType<Input>;
  run(input: Input, ctx: ChainCtx): Promise<Output>;
}

// biome-ignore lint/suspicious/noExplicitAny: the registry holds chains with differing input types
export type AnyChain = Chain<any, any>;

/** What the registry holds: a recipe or a chain, told apart by `kind`. */
export type Registered = AnyRecipe | AnyChain;

/** The context a chain's run() receives: the base Ctx plus composition tools. */
export interface ChainCtx extends Ctx {
  runId: string;
  run: ChildRun; // start a child run
  git: GitHelpers; // commit diffs onto a branch
  pr: PrSink; // read issues, open PRs, comment
  step<T>(name: string, fn: () => Promise<T>): Promise<T>; // emits step.started / step.done
}

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
  | { type: "child.started"; childRunId: string; recipe: string }
  | { type: "child.event"; childRunId: string; recipe: string; event: EngineEvent }
  | { type: "child.done"; childRunId: string; recipe: string; result: RunResult }
  | { type: "step.started"; name: string }
  | { type: "step.done"; name: string }
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
  base: string; // the ref this run works at; "HEAD" for an ordinary run
  depth: number; // child-run nesting depth; a top-level run is 0
  approvePlan: boolean;
  waitApproval(): Promise<boolean>;
  // Composition tools, also exposed to chains through ChainCtx.
  run: ChildRun;
  git: GitHelpers;
  pr: PrSink;
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
}
