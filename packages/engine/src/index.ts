export { createBudget } from "./budget.js";
export { createEngine } from "./engine.js";
export type { ExecResult } from "./exec.js";
export { exec } from "./exec.js";
export {
  anchoredInDiff,
  claimsMatchEvidence,
  closesIssue,
  commandFails,
  commandPasses,
  countNotLess,
  type Evidence,
  failsOnBase,
  failsWithAssertion,
  filesExist,
  mentionsOnlyDiffFiles,
  noFileChanges,
  noPattern,
  onlyTouches,
  outputMatches,
  type ParsedFailure,
  runGates,
} from "./gates/index.js";
export { defineRecipe } from "./recipe.js";
export type { ScheduleCtx, ScheduleResult } from "./scheduler.js";
export { schedule, validateGraph } from "./scheduler.js";
export type { Tracer } from "./trace.js";
export { createTracer, readRuns } from "./trace.js";
export type {
  AnyRecipe,
  Budget,
  Ctx,
  Engine,
  EngineConfig,
  EngineEvent,
  EngineLimits,
  EngineRun,
  Gate,
  GateContext,
  GateResult,
  KeepWorktrees,
  PlanTask,
  Recipe,
  RecipeInfo,
  RunCtx,
  RunErrorKind,
  RunResult,
  RunResultTask,
  RunSummary,
  StartOptions,
  Task,
  TaskResult,
  WorkerConfig,
} from "./types.js";
export {
  createWorktree,
  ensureExcluded,
  getDiff,
  pruneWorktrees,
  removeRunWorktrees,
  removeWorktree,
  worktreeRoot,
} from "./workspace.js";
