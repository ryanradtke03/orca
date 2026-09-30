# @orchestra/engine

The orchestration layer. Where [`@orchestra/messenger`](../messenger) runs **one** Claude call, the engine runs a whole **job**: it takes a recipe and its input, plans tasks, runs each task's worker in its own git worktree through the messenger, checks the work with code gates, retries with feedback, enforces budgets, and returns one final result.

```ts
import { createEngine } from "@orchestra/engine";
import { createMessenger } from "@orchestra/messenger";
import { builtInRecipes } from "@orchestra/recipes";

const engine = createEngine({
  repo: "/path/to/your/repo",
  messenger: createMessenger({ backend: "cli" }),
  recipes: builtInRecipes,
});

const run = engine.start("fix-ci", { command: "npx tsc --noEmit" });
for await (const e of run.events) console.log(e.type);
const result = await run.done; // always resolves, never throws
console.log(result.status, `$${result.costUsd.toFixed(3)}`);
```

- **Engine is _how_, recipe is _what_.** The engine owns the generic mechanics (plan → schedule → isolate → gate → retry → finish). Recipes supply the job-specific decisions (which tasks, which gates, what output).
- **Code decides whether work counts.** A worker never grades itself. Gates run after each attempt; rejection reasons are fed back verbatim into the next attempt's prompt.
- **Your checkout is safe.** Workers only ever run in git worktrees under `.orchestra/worktrees`, on their own branches. Nothing is merged into your branch automatically.
- **Never throws.** `start()` never throws; `run.done` always resolves. Every exit — success, failure, budget stop, cancel — is a clean `RunResult` with a `status` and (on error) an `error.kind`.
- **Swappable messenger.** Code written against the `Messenger` interface works with the real CLI backend and the test `ScriptedMessenger` alike.

---

## Contents

1. [Requirements](#requirements)
2. [Concepts](#concepts)
3. [API](#api)
4. [Recipes](#recipes)
5. [Events & results](#events--results)
6. [Gates](#gates)
7. [Testing](#testing)
8. [How it works](#how-it-works)

---

## Requirements

- Node 22+
- git (the engine shells out to `git worktree`)
- For **real** runs: [Claude Code](https://code.claude.com) installed and logged in (the CLI messenger backend spawns `claude -p`)

Inside the monorepo, depend on it through the workspace:

```jsonc
{ "dependencies": { "@orchestra/engine": "workspace:*" } }
```

---

## Concepts

| Piece | Owned by | Examples |
| --- | --- | --- |
| Flow: plan → tasks → workers → gates → finish | **engine** | always the same |
| Scheduling: dependency order, parallel workers, `maxWorkers` | **engine** | — |
| Isolation, budgets, cancel, retries, events, traces | **engine** | — |
| Which tasks exist and what depends on what | **recipe** | `plan()` |
| How each task's worker runs (prompt, tools, paths) | **recipe** | `worker()` |
| Which checks decide "good work" | **recipe** | `gates` |
| The final output (PR, patch, report) | **recipe** | `finish()` |

Rule of thumb: if the same decision logic shows up in two recipes, it belongs in the engine or in `shared/`.

---

## API

At a glance:

```ts
createEngine(config)                 → Engine            // one per app
engine.start(recipe, input, opts?)   → EngineRun         // starts immediately
engine.recipes()                     → RecipeInfo[]      // sync
engine.runs()                        → Promise<RunSummary[]>
engine.get(runId)                    → EngineRun | undefined

run.id                               : string
run.events                           : AsyncIterable<EngineEvent>
run.done                             : Promise<RunResult> // always resolves
run.cancel()                         → void
run.approve(ok: boolean)             → void
```

---

### `createEngine(config)` → `Engine`

Builds one engine. Cheap and synchronous — nothing runs until `start()`. You normally make one per app (CLI, Electron main process, backend) and reuse it.

```ts
const engine = createEngine({
  repo: "/path/to/repo",
  messenger: createMessenger({ backend: "cli" }),
  recipes: builtInRecipes,
  limits: { maxWorkers: 2, maxCostUsd: 3 },
  traceDir: ".orchestra/runs",
});
```

**`config: EngineConfig`**

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `repo` | `string` | **required** | Absolute path to the git repo the engine works on. Worktrees are cut from its current `HEAD`. |
| `messenger` | `Messenger` | **required** | Anything implementing `Messenger.send()` — the real CLI backend, the test `ScriptedMessenger`, or a future SDK backend. |
| `recipes` | `Record<string, Recipe>` | **required** | The registry `start()` looks names up in. A name that isn't here → `unknown_recipe`. |
| `limits` | `Partial<EngineLimits>` | see below | Run caps. Any subset; the rest fall back to defaults. |
| `worktreeDir` | `string` | `<repo>/.orchestra/worktrees` | Where per-task worktrees are created. Gitignored, and auto-added to `.git/info/exclude`. |
| `traceDir` | `string` | _none_ | If set, each run writes `events.jsonl` + `summary.json` under `<traceDir>/<runId>/`. Required for `engine.runs()` to return anything. |
| `keepWorktrees` | `"always" \| "on-failure" \| "never"` | `"on-failure"` | What to do with worktrees after a run. `on-failure` keeps only failed tasks' worktrees for debugging; a cancelled run always cleans everything. |

**`EngineLimits`** (all optional in `config.limits`, filled with these defaults):

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `maxWorkers` | `number` | `2` | How many tasks may run at the same time. |
| `maxAttempts` | `number` | `3` | Worker attempts per task before it's marked failed. |
| `maxCostUsd` | `number` | `3` | Total USD across all workers in the run. Re-checked between scheduling waves; when hit, the run stops as `partial` with `error.kind: "budget"`. |
| `maxDurationMs` | `number` | `1_800_000` (30 min) | Wall-clock cap for the run → `partial` / `timeout`. |

> **Budget granularity.** Cost and time are checked _between_ tasks/waves, not mid-worker. With `maxWorkers > 2`, several tasks in one wave can push spend past `maxCostUsd` before the next check — you can't un-spend a worker that's already running. A `budget.warning` event fires once at 80% of each cap.

---

### `engine.start(name, input, opts?)` → `EngineRun`

Starts a job **immediately** and returns a handle. Never throws — a bad name, bad input, or a crash all come back through `run.done` as a `RunResult` with `ok: false`.

```ts
const run = engine.start("fix-ci", { command: "npx tsc --noEmit" }, {
  signal: controller.signal,
  approvePlan: true,
  limits: { maxCostUsd: 1 },
});
```

**Parameters**

| Param | Type | Description |
| --- | --- | --- |
| `name` | `string` | Key into the `recipes` registry. Unknown → run ends `unknown_recipe`. |
| `input` | `unknown` | Validated against the recipe's Zod `input` schema before anything runs. Invalid → `invalid_input`, and **no worker is spawned**. |
| `opts?` | `StartOptions` | Per-run overrides (below). |

**`opts: StartOptions`** (all optional)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `signal` | `AbortSignal` | _none_ | A caller-owned signal. Aborting it is equivalent to `run.cancel()`: workers stop, worktrees are cleaned, the run ends `cancelled`. Passing an already-aborted signal cancels immediately. |
| `approvePlan` | `boolean` | `false` | When `true`, after planning the run emits `plan.ready` then `approval.needed` and **waits** for `run.approve(ok)`. `approve(false)` (or a cancel) ends the run `cancelled` before any worker runs. |
| `limits` | `Partial<EngineLimits>` | inherits `config.limits` | Overrides just for this run, merged over the engine's limits. |

---

### `engine.recipes()` → `RecipeInfo[]`

Synchronous. Describes every registered recipe — for CLI `--help`, an Electron dropdown, or building an input form.

```ts
interface RecipeInfo {
  name: string;
  description: string;
  inputSchema: unknown; // JSON Schema, generated from the recipe's Zod input
}
```

`inputSchema` comes from `z.toJSONSchema(recipe.input)`; a schema Zod can't serialize yields `{}` rather than throwing.

---

### `engine.runs()` → `Promise<RunSummary[]>`

Reads finished runs back from `traceDir`, **newest first**. Returns `[]` if no `traceDir` is configured or the folder doesn't exist yet.

```ts
interface RunSummary {
  id: string;         // == the run's id / trace folder name
  finishedAt: string; // ISO timestamp
  status: "completed" | "partial" | "failed" | "cancelled";
  ok: boolean;
  costUsd: number;
  durationMs: number;
  tracePath: string;  // <traceDir>/<id>
}
```

To load a past run's full detail, read `summary.json` (the `RunResult`) or `events.jsonl` under `tracePath`.

---

### `engine.get(runId)` → `EngineRun | undefined`

Returns a run **still in progress**, so a UI can reattach to its `events`/`done` after navigating away. Backed by an in-memory registry that clears the moment a run finishes, so a completed run returns `undefined` — use `runs()` for history.

---

### The `EngineRun` handle

Returned by `start()` (and `get()`).

| Member | Type | Description |
| --- | --- | --- |
| `id` | `string` | The run id, also its trace folder name. Generated as `run-<timestamp>-<rand>`. |
| `events` | `AsyncIterable<EngineEvent>` | The live event stream. Iterate with `for await`. Yields until `run.done` (a `run.done` event is the last item), then completes. Not iterating does **not** stall the run — `done` resolves regardless. |
| `done` | `Promise<RunResult>` | Resolves once, with the final result. **Never rejects** — failures are `ok: false` with an `error.kind`. |
| `cancel()` | `() => void` | Aborts the run: signals workers via the messenger, cleans up worktrees, and ends the run `cancelled`. Safe to call any time (including while paused for approval, which it resolves as rejected). |
| `approve(ok)` | `(ok: boolean) => void` | Answers an `approval.needed` prompt. `true` proceeds; `false` cancels. No-op if the run isn't waiting on approval. |

A typical consumer reads both — the stream for progress, the promise for the outcome:

```ts
const run = engine.start("fix-ci", { command: "npx tsc --noEmit" });

for await (const e of run.events) {
  if (e.type === "task.started") console.log(`▶ ${e.taskId} (attempt ${e.attempt})`);
  if (e.type === "gate.failed")  console.log(`  ✗ ${e.gate}: ${e.reasons.join("; ")}`);
  if (e.type === "task.done")    console.log(`  ✓ ${e.taskId} $${e.costUsd.toFixed(3)}`);
}

const result = await run.done;
```

> In a request/response server, don't `await run.done` inside the handler — jobs take minutes. Return `run.id`, then stream `engine.get(id).events` over SSE and let the run finish in the background.

---

## Recipes

A recipe is an object with hooks. The engine looks it up by name and calls the hooks at the right moments; it never contains job logic itself.

```ts
import { defineRecipe, commandPasses, noPattern } from "@orchestra/engine";
import { z } from "zod";

export const fixCi = defineRecipe({
  name: "fix-ci",
  description: "Make a failing command pass",
  input: z.object({ command: z.string() }),

  async plan(input) {
    return [{ id: "fix", goal: `Make \`${input.command}\` pass`, dependsOn: [], context: input }];
  },
  worker: (task) => ({
    prompt: `${task.goal}. Run it, read the errors, fix the code.`,
    tools: ["Read", "Edit", "Grep", "Glob", `Bash(${task.context["command"]})`],
    maxTurns: 25,
  }),
  gates: [
    commandPasses((task) => String(task.context["command"])), // must exit 0
    noPattern([/@ts-ignore/, /eslint-disable/]),               // no cheating
  ],
  async finish(results) {
    return { fixed: results.every((r) => r.ok) };
  },
});
```

Tasks can depend on each other; independent tasks run in parallel up to `maxWorkers`. A task whose dependency failed (or was skipped) is skipped transitively.

The built-in recipes live in [`@orchestra/recipes`](../recipes): `fix-ci` and `add-component` (which fans out a component into a parallel test + story).

### Contract reference

Every hook the engine calls, and when:

| Hook | Signature | Called | Decides |
| --- | --- | --- | --- |
| `input` | `z.ZodType<Input>` | before anything runs | the shape of valid input; invalid → `invalid_input` |
| `plan` | `(input, ctx) => Promise<Task[]>` | once, after validation | which tasks exist and their dependencies |
| `worker` | `(task, ctx) => WorkerConfig` | per task attempt | how that attempt's Claude call runs |
| `gates` | `Gate[]` | after each attempt | whether the attempt counts as done |
| `onFailed?` | `(task, reasons, ctx) => Promise<void>` | when a task exhausts `maxAttempts` | side effects on give-up (quarantine, report…) |
| `finish` | `(results, ctx) => Promise<Output>` | once, after all tasks | the run's `output` |

`defineRecipe({ ... })` is just an identity helper that infers `Input` from the Zod schema so `plan`/`worker`/`finish` are fully typed.

**`Task`** — one unit of work. `context` is your bag of per-task data (read it back in `worker`/`gates`).

```ts
interface Task { id: string; goal: string; dependsOn: string[]; context: Record<string, unknown>; }
```

**`WorkerConfig`** — what `worker()` returns; passed straight to `messenger.send()`.

| Field | Type | Description |
| --- | --- | --- |
| `prompt` | `string` | The task prompt. On a retry, the engine prepends the previous attempt's rejection reasons. |
| `tools` | `string[]` | Allowed tools, e.g. `["Read", "Edit", "Bash(npm test)"]`. |
| `allowEdits?` | `string[]` | Path globs the worker should stay within (enforce with the `onlyTouches` gate). |
| `maxTurns?` | `number` | Cap on the worker's turns. |
| `model?` | `string` | e.g. `"sonnet"`, `"haiku"`. |
| `system?` | `string` | Extra system prompt. |

**`ctx: Ctx`** — passed to `plan`/`worker`/`gates`/`finish`. The engine owns it; recipes read from it.

| Member | Type | Use |
| --- | --- | --- |
| `repo` | `string` | The target repo path. |
| `messenger` | `Messenger` | For recipes that run their own planner/triage agents via `askJson`. |
| `signal` | `AbortSignal` | Aborted when the run is cancelled. |
| `emit` | `(event) => void` | Emit a custom engine event onto the stream. |

**`Gate` / `GateContext`** — a gate is `{ name, check(ctx) }` returning `{ ok: true }` or `{ ok: false, reasons }`. Its `ctx` gives the evidence:

```ts
interface GateContext {
  worktree: string;                     // the attempt's checkout
  task: Task;
  diff: string;                         // staged diff vs HEAD
  changedFiles: string[];
  exec(cmd, opts?): Promise<{ code; stdout; stderr }>; // run a command in the worktree
}
```

---

## Events & results

`run.events` streams typed `EngineEvent`s. Every event has a `type`; the discriminated union means narrowing on `type` gives you the right fields.

| `type` | Fires when | Key fields |
| --- | --- | --- |
| `run.started` | input validated, job accepted | `recipe`, `input` |
| `plan.ready` | tasks decided | `tasks: { id, goal, dependsOn }[]` |
| `approval.needed` | waiting on `run.approve()` (only with `approvePlan`) | `what` (e.g. `"plan"`) |
| `task.started` | a worker attempt began | `taskId`, `attempt`, `worktree` |
| `worker.event` | a messenger event from that worker | `taskId`, `event` (the raw `MessengerEvent`) |
| `gate.passed` / `gate.failed` | a gate ran | `taskId`, `gate`, (`reasons` on fail) |
| `task.retrying` | gates failed, trying again | `taskId`, `attempt`, `reasons` |
| `task.done` | a task succeeded | `taskId`, `attempts`, `costUsd` |
| `task.failed` | a task exhausted its attempts | `taskId`, `reasons` |
| `task.skipped` | a dependency failed/was skipped | `taskId`, `reason` |
| `budget.warning` | 80% of a cap reached | `resource` (`"cost"`/`"duration"`), `used`, `limit` |
| `run.done` | the end | `result` (the `RunResult`) |

`run.done` (the promise) resolves to a `RunResult`:

```ts
interface RunResult {
  ok: boolean;
  status: "completed" | "partial" | "failed" | "cancelled";
  output?: unknown;                 // whatever the recipe's finish() returned
  tasks: { id; ok; attempts; costUsd; diff?; failures? }[];
  costUsd: number;
  durationMs: number;
  tracePath: string;
  error?: { kind: RunErrorKind; message: string };
}
```

`error.kind` is one of `unknown_recipe`, `invalid_input`, `plan_failed`, `finish_failed`, `budget`, `timeout`, `cancelled`. Task-level failures (gates never passed) don't set `error` — they show up in `tasks[].failures` and make the status `partial` or `failed`.

---

## Gates

Ready-made, composable checks a recipe lists in `gates`:

| Gate | Fails when |
| --- | --- |
| `commandPasses(cmd)` | the command doesn't exit 0 (tail of its output becomes the reason) |
| `noPattern(regexes)` | an **added** diff line matches a disallowed pattern |
| `onlyTouches(globs)` | a changed file falls outside the allowed globs |
| `filesExist(paths)` | a required file is missing from the worktree |

A gate is just `{ name, check(ctx) }`, so recipes can define their own inline (see `add-component`'s `fileCreated`).

---

## Testing

### The automated suite (no Claude, no network)

The tests use a temporary git repo and a `ScriptedMessenger` that actually edits the worktree, so the whole loop is exercised deterministically:

```bash
pnpm --filter @orchestra/engine test        # 36 tests across workspace/gates/task/scheduler/engine
pnpm --filter @orchestra/engine typecheck
```

There are also standalone check scripts that print what's happening, handy while developing:

```bash
pnpm --filter @orchestra/engine exec tsx scripts/check-skeleton.ts   # phase 1: a diff comes back
pnpm --filter @orchestra/engine exec tsx scripts/check-gates.ts      # phase 2: gates + retry
pnpm --filter @orchestra/engine exec tsx scripts/check-harden.ts     # phase 3: validation/budget/cancel
pnpm --filter @orchestra/engine exec tsx scripts/check-scheduler.ts  # phase 4: scheduler + approval
```

### A real end-to-end run (drives Claude)

Needs Claude Code logged in. Point the demo at a scratch repo with something broken:

```bash
# make a throwaway repo with one type error
mkdir -p /tmp/orca-demo && cd /tmp/orca-demo
git init -q && git config user.email you@test.dev && git config user.name You
printf 'export const n: number = "not a number";\n' > index.ts
git add -A && git commit -qm initial

# from the orca repo, run fix-ci against it
cd -  # back to the monorepo
pnpm --filter @orchestra/recipes demo /tmp/orca-demo "npx tsc --noEmit"
```

You'll see the events stream, the final `RunResult`, and the diff Claude produced — all on a branch in `/tmp/orca-demo/.orchestra/worktrees/`, never on your checkout.

---

## How it works

`engine.start()` → `runRecipe` runs the top-level flow: **validate → plan → validate graph → (approve) → schedule → finish**. `schedule` drives tasks in dependency order up to `maxWorkers`, each through `runTask`, which is the retry loop: fresh worktree → messenger → gates → (retry with feedback | done | give up). A `Budget` caps cost and time; an `AbortController` powers cancel. When `traceDir` is set, every event is teed to `events.jsonl` and the result to `summary.json`.

See [`Engine Design`](https://claude.ai/artifact/BQUsq8wFy1DeeSVThPZTzy) for the full design doc this package was built from.
