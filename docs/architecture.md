# Architecture

This doc covers how Orca's packages fit together and what happens, step by step, when a recipe runs. [The recipe catalog](./recipe-catalog.md) describes each recipe. This doc describes the runtime that runs them.

## The four packages

Each package depends only on the ones below it. The messenger knows nothing about the engine, and the engine knows nothing about any specific recipe.

```
┌────────────────────────────────────────────────────────────────────────┐
│  cli  (@orchestra/cli)      deps: engine, messenger, recipes, zod, tsx │
│  The orca binary. Most commands call loadConfig(flags), then           │
│  buildEngine(config), then the engine: recipes(), runs(), or           │
│  start() with streamEvents() printing progress to stderr.              │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ depends on
┌──────────────────────────────▼─────────────────────────────────────────┐
│  recipes  (@orchestra/recipes)          deps: engine, messenger, zod   │
│  The concrete jobs:                                                    │
│    repro-bug, fix-ci, fix-lint, update-tests, add-component,           │
│    pr-describe, pr-review, and the bug-to-pr chain                     │
│  Each recipe supplies plan(), worker(), gates, and finish().           │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ depends on
┌──────────────────────────────▼─────────────────────────────────────────┐
│  engine  (@orchestra/engine)                    deps: messenger, zod   │
│  Runs jobs. For each task: a git worktree, a worker, the gates,        │
│  and retries with feedback. Also budgets, traces, PR sinks             │
│  (github or local), and chains of child runs.                          │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ calls Claude through
┌──────────────────────────────▼─────────────────────────────────────────┐
│  messenger  (@orchestra/messenger)                        deps: zod    │
│  The only code that starts Claude Code.                                │
│    Messenger.send(req) returns a run with an event stream and a done   │
│    CliMessenger spawns the claude binary                               │
│    FakeMessenger replays recorded .jsonl fixtures for tests            │
└──────────────────────────────┬─────────────────────────────────────────┘
                               ▼
                     the claude CLI process
```

- **messenger** turns a `MessengerRequest` into a `claude` process and streams its events back. Every run ends with one `done` event that carries `ok`, the reply text, the session id, and the cost. The backend is swappable, so the engine never starts a process itself.
- **engine** validates input, plans, runs tasks in parallel in separate git worktrees, checks each attempt with gates, retries, enforces the budget, opens PRs through a `PrSink`, and writes traces.
- **recipes** is the only package that names concrete jobs. `bug-to-pr` is a chain: it runs `repro-bug`, then `fix-ci`, then `pr-describe` and `pr-review` in parallel, and then opens the PR.
- **cli** is the `orca` binary. `packages/cli/src/engine-factory.ts` builds the engine from the resolved config, and `packages/cli/src/events.ts` prints the event stream. Code can also skip the CLI and call `createEngine(...)` and `engine.start(name, input)` directly.

## How the engine and a recipe work together

A recipe is a set of hooks, and the engine calls them in a fixed order. The recipe makes the decisions and the engine runs everything. A recipe never calls the engine.

A recipe (`Recipe` in `packages/engine/src/types.ts`) gives the engine these things:

```ts
interface Recipe<Input, Output> {
  input:  z.ZodType<Input>;                  // validated before anything runs
  plan:   (input, ctx) => Promise<Task[]>;   // which work exists
  worker: (task, ctx) => WorkerConfig;       // the prompt and tools for one task
  gates:  Gate[];                            // code that checks the worker's result
  finish: (results, ctx) => Promise<Output>; // combines task results into the output
  onFailed?(task, reasons, ctx);             // optional, called when a task gives up
}
```

`defineRecipe()` in `packages/engine/src/recipe.ts` returns its argument unchanged. It does nothing at run time. It exists so TypeScript can infer the input type of `plan`, `worker`, and `finish` from the Zod schema.

Each hook receives a `Ctx` with `repo`, `messenger`, `exec`, `emit`, and `signal`. Recipes use it to look and ask, not to run things. `fix-ci`, for example, calls `ctx.exec` in `plan()` to see whether the command already passes. The engine creates worktrees, calls `messenger.send`, counts cost, retries, and cleans up.

### The driver: `runRecipe()` in `packages/engine/src/lifecycle.ts`

```
1. Look up the recipe. If it's missing, end with unknown_recipe.
2. recipe.input.safeParse(input). If it fails, end with invalid_input. Nothing runs.
3. tasks = recipe.plan(input, ctx)
4. validateGraph(tasks), then wait for approval if approvePlan is set.
5. schedule(tasks, runTask, ctx), which respects maxWorkers and dependsOn.
6. If the budget ran out or the run was cancelled, end as partial or cancelled
   without calling finish().
7. output = recipe.finish(results, ctx). The status is completed when every task
   succeeded, failed when none did, and partial otherwise.
```

Every way out of a run ends in a `RunResult`. If `plan()` throws, the run ends with `plan_failed`. If `finish()` throws, it ends with `finish_failed`. If anything else throws, such as `worker()`, the engine catches it in `packages/engine/src/run.ts` and the run ends `failed` with `plan_failed`.

### Chains

A chain such as `bug-to-pr` sits in the same registry as recipes, but it has no `plan`, `worker`, or `gates`. Its `run(input, ctx)` receives a `ChainCtx` (in `types.ts`) with four extra members: `run` starts a child recipe, `git` commits diffs onto branches, `pr` reads issues and opens PRs, and `step()` wraps a block of plain code with `step.started` and `step.done` events.

Each `ctx.run(...)` goes through the same `runRecipe` and `runTask` loop as a top-level run. A child's spending counts against the parent's budget, and the chain can give a child a lower cost cap of its own. Child runs can nest 3 levels deep.

## A full trace: `fix-ci`

The input is `{ command: "pnpm check" }`, and the recipe source is `packages/recipes/src/fix-ci/index.ts`. Each line starts with the actor.

```
user:      orca run fix-ci --set command="pnpm check"
           (in code: engine.start("fix-ci", { command: "pnpm check" }))
```

### Setup and validation in `runRecipe()`

```
engine:    look up "fix-ci"                  found (otherwise unknown_recipe)
engine:    emit { type: "run.started" }      the user sees the run start
engine:    fixCi.input.safeParse(input)      valid (otherwise invalid_input)
engine:    ensureExcluded(repo)              add .orca/ to .git/info/exclude
```

### `plan()`: the recipe decides whether there is work

```
engine:    call fixCi.plan(input, ctx)
recipe:      ctx.exec("pnpm check")          the engine runs it in the repo root
engine:        returns { code, output }
recipe:      code is not 0, so return one task:
               { id: "fix", goal: "Make `pnpm check` pass",
                 context: { command, failure: <last 6000 characters of output> } }
           (if code is 0, plan returns [] and the run goes straight to finish)
engine:    validateGraph([fix])              ok
engine:    emit { type: "plan.ready", tasks: [fix] }
engine:    skip plan approval unless approvePlan is set
```

### `runTask()`: the attempt loop in `packages/engine/src/task.ts`

`maxAttempts` defaults to 3. Attempt 1:

```
engine:    createWorktree(repo, runId, "fix", attempt 1)    a separate git checkout
engine:    emit { type: "task.started", worktree }

engine:    call fixCi.worker(task, ctx)
recipe:      return {
               prompt: "Make `pnpm check` pass. Fix the root cause in the source code.
                        Current failure: <failure>",
               tools: [Read, Edit, Grep, Glob, Bash(pnpm check),
                       Bash(pnpm test:*), Bash(pnpm typecheck:*)],
               maxTurns: 25 }

engine:    messenger.send({ prompt, cwd: worktree, tools, maxTurns, signal })
messenger:   start claude in the worktree
claude:        reads files, edits source, runs pnpm check, repeats
messenger:   stream events; the engine re-emits each one as worker.event
messenger:   done { ok: true, text, costUsd, sessionId }
engine:    budget.add(costUsd)
engine:    getDiff(worktree)                 stages everything, returns { patch, files }
```

If the worker itself fails, for example by hitting `maxTurns`, the engine skips the gates and uses `worker failed: <kind>: <message>` as the rejection reason.

### Gates: code checks the work

The worker never grades itself.

```
engine:    runGates(fixCi.gates, gateCtx)
           gateCtx = { worktree, task, diff, changedFiles, output, exec }
gate 1:    noFileChanges(TEST_AND_CONFIG)    did the diff change a test file,
                                             tsconfig, package.json, or vitest config?
                                             Checks file names only, so it's cheap.
gate 2:    noPattern(CHEATS)                 did an added line contain @ts-ignore,
                                             eslint-disable, .skip(, as any, or similar?
                                             Checks added lines only, so it's cheap.
gate 3:    commandPasses("pnpm check")       runs pnpm check inside the worktree.
                                             This is the expensive one, so it runs last.
```

If every gate passes:

```
engine:    emit { type: "task.done", attempts: 1, costUsd }
engine:    return { ok: true, diff, output, worktree }
```

If a gate fails, for example because Claude added `as any`:

```
engine:    reasons = ["added line matches disallowed pattern /\bas any\b/: <the line>"]
engine:    emit { type: "task.retrying", attempt: 1, reasons }
engine:    removeWorktree(attempt 1)
engine:    attempt 2: a fresh worktree, worker() again, and withFeedback() adds
           this after the prompt:
             "Your previous attempt was rejected. Fix these problems and try again:
              - added line matches disallowed pattern /\bas any\b/: <the line>"
           The same send, gates, and retry loop runs up to maxAttempts times.
           The engine also stops retrying if the run is cancelled or out of budget.
           If the last attempt still fails:
engine:    call fixCi.onFailed if it exists (fix-ci has none)
engine:    emit { type: "task.failed", reasons }
engine:    return { ok: false, failures: reasons }
```

The engine doesn't emit `task.retrying` after the last attempt, and it keeps that attempt's worktree until cleanup.

### `finish()`: the recipe builds the output

```
engine:    cleanupWorktrees()                with the default on-failure policy, removes
                                             worktrees of tasks that succeeded
engine:    call fixCi.finish(results, ctx)
recipe:      return { fixed: results.every((r) => r.ok),
                      diffs: results.map((r) => r.diff) }
             (with no tasks, fixed is true: the command was already passing)
engine:    status: completed, partial, or failed, from the task results
engine:    return { ok, status, output, tasks, costUsd, durationMs, tracePath }

user:      { ok: true, status: "completed",
             output: { fixed: true, diffs: [<patch>] } }
```

### Who does what

| Actor | Does |
| --- | --- |
| user | names the recipe and input, watches the events, and gets a `RunResult` |
| engine | validates input; calls `plan`, `worker`, the gates, and `finish`; creates worktrees; tracks the budget; retries with feedback; and decides the final status |
| recipe | decides whether there is work (`plan`), what to tell Claude (`worker`), what counts as success (`gates`), and what to return (`finish`). It runs nothing itself. |
| messenger | turns the worker's prompt into a `claude` process, streams its events, and reports `ok` and `costUsd` |
| claude | reads and edits code and runs the command inside the worktree |

In `fix-ci`, `worker()` only asks Claude to make the command pass. The `commandPasses` gate checks that claim by running `pnpm check` again in the worktree. `noFileChanges` and `noPattern` reject attempts that edit tests or config or add `as any` to get there. The engine copies each rejection reason into the next attempt's prompt.
