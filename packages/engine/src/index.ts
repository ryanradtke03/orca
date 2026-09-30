export { createEngine } from "./engine.js";
export type { ExecResult } from "./exec.js";
export { exec } from "./exec.js";
export { commandPasses, noPattern, runGates } from "./gates/index.js";
export { defineRecipe } from "./recipe.js";
export type {
  AnyRecipe,
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
  Recipe,
  RunCtx,
  RunErrorKind,
  RunResult,
  RunResultTask,
  StartOptions,
  Task,
  TaskResult,
  WorkerConfig,
} from "./types.js";
export {
  createWorktree,
  getDiff,
  removeWorktree,
  worktreeRoot,
} from "./workspace.js";
