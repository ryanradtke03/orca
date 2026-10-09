# @orchestra/engine

The engine runs a whole job. [`@orchestra/messenger`](../messenger) runs a single Claude Code call. The engine takes a recipe and its input, plans tasks, runs each task's worker in its own git worktree through the messenger, checks the work with gates, retries with feedback, enforces budgets, and returns one result.

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

Five rules shape the design.

- **The engine owns the mechanics, the recipe owns the decisions.** The engine plans, schedules, isolates, gates, retries, and finishes. A recipe decides which tasks exist, which gates apply, and what the output is.
- **Code decides whether work counts.** A worker never grades itself. Gates run after each attempt, and the engine copies their rejection reasons into the next attempt's prompt.
- **Your checkout stays put.** Workers run only in git worktrees under `.orca/worktrees`, each on its own `orca/<run>/<task>-<attempt>` branch. The engine never merges into your branch.
- **Nothing throws.** `start()` never throws and `run.done` always resolves. Success, failure, a budget stop, and a cancel all end in a `RunResult` with a `status`, plus an `error.kind` when something went wrong.
- **The messenger is swappable.** Code written against the `Messenger` interface works with the real CLI backend and with test messengers.

## Contents

1. [Requirements](#requirements)
2. [Concepts](#concepts)
3. [API](#api)
4. [Recipes](#recipes)
5. [Chains](#chains)
6. [Events and results](#events-and-results)
7. [Gates](#gates)
8. [Testing](#testing)
9. [How it works](#how-it-works)

## Requirements

- Node 20 or later, per the root `package.json`.
- git. The engine shells out to `git worktree`.
- For real runs, [Claude Code](https://code.claude.com) installed and logged in. The CLI messenger backend spawns `claude -p`.

Inside the monorepo, depend on the engine through the workspace:

```jsonc
{ "dependencies": { "@orchestra/engine": "workspace:*" } }
```

## Concepts

| Piece | Owned by | Where |
| --- | --- | --- |
| The flow: plan, tasks, workers, gates, finish | engine | always the same |
| Scheduling: dependency order, parallel workers, `maxWorkers` | engine | |
| Isolation, budgets, cancel, retries, events, traces | engine | |
| Which tasks exist and what depends on what | recipe | `plan()` |
| How each task's worker runs: prompt, tools, paths | recipe | `worker()` |
| Which checks decide whether work is good | recipe | `gates` |
| The final output, such as a patch or a report | recipe | `finish()` |
| A sequence of child runs and steps | chain | `run()` |

If the same decision logic shows up in two recipes, move it into the engine.

## API

```ts
createEngine(config): Engine                       // one per app
engine.start(name, input, opts?): EngineRun        // starts immediately
engine.recipes(): RecipeInfo[]                     // synchronous
engine.runs(): Promise<RunSummary[]>
engine.get(runId): EngineRun | undefined

run.id: string
run.events: AsyncIterable<EngineEvent>
run.done: Promise<RunResult>                       // always resolves
run.cancel(): void
run.approve(ok: boolean): void
```

### `createEngine(config)`

Builds one engine. It is synchronous and does no work until you call `start()`. Make one per app, such as a CLI or an Electron main process, and reuse it.

```ts
const engine = createEngine({
  repo: "/path/to/repo",
  messenger: createMessenger({ backend: "cli" }),
  recipes: builtInRecipes,
  pr: localSink({ dir: "/path/to/repo/.orca" }),
  limits: { maxWorkers: 2, maxCostUsd: 3 },
  traceDir: "/path/to/repo/.orca/traces",
});
```

`config: EngineConfig`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `repo` | `string` | required | Absolute path to the git repo. Worktrees are cut from `HEAD`, or from the `base` start option. |
| `messenger` | `Messenger` | required | Anything with a `send()` method, such as the CLI backend or `FakeMessenger`. |
| `recipes` | `Record<string, Registered>` | required | The registry `start()` looks names up in. Each entry is a recipe or a chain. An unknown name ends the run with `unknown_recipe`. |
| `pr` | `PrSink` | none | Where chains read issues, open PRs, and comment. Use `githubSink` or `localSink`. Without one, any PR call from a chain fails with "no PR sink configured on the engine". |
| `limits` | `Partial<EngineLimits>` | see below | Run caps. Any field you leave out uses the default. |
| `worktreeDir` | `string` | `<repo>/.orca/worktrees` | Where per-task worktrees go. The engine adds `.orca/` to `.git/info/exclude`. |
| `traceDir` | `string` | none | When set, each run writes `events.jsonl` and `summary.json` under `<traceDir>/<runId>/`. `engine.runs()` returns nothing without it. |
| `keepWorktrees` | `"always" \| "on-failure" \| "never"` | `"on-failure"` | What happens to worktrees after a run. `on-failure` keeps only failed tasks' worktrees for debugging. A cancelled run always cleans everything. |

`EngineLimits` defaults:

| Field | Default | Meaning |
| --- | --- | --- |
| `maxWorkers` | `2` | How many tasks run at the same time. |
| `maxAttempts` | `3` | Worker attempts per task before the task fails. |
| `maxCostUsd` | `3` | Total USD across all workers in the run. When the run hits it, it stops as `partial` with `error.kind: "budget"`. |
| `maxDurationMs` | `1_800_000`, 30 minutes | Wall-clock cap. Hitting it ends the run as `partial` with `error.kind: "timeout"`. |

The engine checks cost and time between tasks and scheduling waves, not in the middle of a worker. A worker that is already running finishes and spends what it spends, so one wave can push the total past `maxCostUsd` before the next check. A `budget.warning` event fires once when a run reaches 80% of each cap.

### `engine.start(name, input, opts?)`

Starts a job right away and returns a handle. It never throws. A bad name, bad input, or a crash all come back through `run.done` as a `RunResult` with `ok: false`.

```ts
const run = engine.start("fix-ci", { command: "npx tsc --noEmit" }, {
  signal: controller.signal,
  approvePlan: true,
  limits: { maxCostUsd: 1 },
  base: "main",
});
```

| Param | Type | Description |
| --- | --- | --- |
| `name` | `string` | A key in the `recipes` registry. An unknown name ends the run with `unknown_recipe`. |
| `input` | `unknown` | The engine validates it against the recipe's Zod `input` schema before anything runs. Invalid input ends the run with `invalid_input`, and no worker starts. |
| `opts` | `StartOptions` | Optional per-run settings, below. |

`opts: StartOptions`, all optional:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `signal` | `AbortSignal` | none | Aborting it is the same as calling `run.cancel()`. Workers stop, worktrees are cleaned, and the run ends `cancelled`. A signal that is already aborted cancels immediately. |
| `approvePlan` | `boolean` | `false` | When `true`, the run emits `plan.ready` and `approval.needed` after planning, then waits for `run.approve(ok)`. `approve(false)` or a cancel ends the run `cancelled` before any worker runs. |
| `limits` | `Partial<EngineLimits>` | `config.limits` | Overrides for this run only, merged over the engine's limits. |
| `base` | `string` | `"HEAD"` | A branch or commit to run against. |

### `engine.recipes()`

Synchronous. Describes every registered recipe and chain, for CLI help or for building an input form.

```ts
interface RecipeInfo {
  name: string;
  description: string;
  inputSchema: unknown; // JSON Schema generated from the recipe's Zod input
}
```

The engine generates `inputSchema` from the Zod schema. A schema that Zod can't convert produces `{}` instead of an error.

### `engine.runs()`

Reads finished runs from `traceDir`, newest first. It returns `[]` when there is no `traceDir` or the folder doesn't exist yet.

```ts
interface RunSummary {
  id: string;         // the run id, which is also the trace folder name
  finishedAt: string; // ISO timestamp
  status: "completed" | "partial" | "failed" | "cancelled";
  ok: boolean;
  costUsd: number;
  durationMs: number;
  tracePath: string;  // <traceDir>/<id>
}
```

For a past run's full detail, read `summary.json`, which holds the `RunResult`, or `events.jsonl` under `tracePath`.

### `engine.get(runId)`

Returns a run that is still in progress, so a UI can reattach to its `events` and `done` after navigating away. The engine drops a run from this registry when it finishes, so a completed run returns `undefined`. Use `runs()` for history.

### The `EngineRun` handle

`start()` and `get()` return it.

| Member | Type | Description |
| --- | --- | --- |
| `id` | `string` | The run id, `run-<timestamp>-<random>`. It is also the trace folder name. |
| `events` | `AsyncIterable<EngineEvent>` | The live event stream. The last item is a `run.done` event, then the stream ends. The run doesn't wait for you to read it, so `done` resolves either way. |
| `done` | `Promise<RunResult>` | Resolves once with the final result. It never rejects. Failures have `ok: false` and an `error.kind`. |
| `cancel()` | `() => void` | Stops the run: the engine signals workers through the messenger, removes worktrees, and ends the run `cancelled`. You can call it at any time, including while the run waits for approval. |
| `approve(ok)` | `(ok: boolean) => void` | Answers `approval.needed`. `true` continues and `false` cancels. It does nothing if the run isn't waiting. |

Read the stream for progress and the promise for the outcome:

```ts
const run = engine.start("fix-ci", { command: "npx tsc --noEmit" });

for await (const e of run.events) {
  if (e.type === "task.started") console.log(`start ${e.taskId} (attempt ${e.attempt})`);
  if (e.type === "gate.failed")  console.log(`  fail ${e.gate}: ${e.reasons.join("; ")}`);
  if (e.type === "task.done")    console.log(`  done ${e.taskId} $${e.costUsd.toFixed(3)}`);
}

const result = await run.done;
```

Jobs take minutes, so a request/response server shouldn't `await run.done` inside a handler. Return `run.id`, stream `engine.get(id).events` over SSE, and let the run finish in the background.

## Recipes

A recipe is an object with hooks. The engine looks it up by name and calls each hook at the right point. The engine itself holds no job logic.

```ts
import { commandPasses, defineRecipe, noPattern } from "@orchestra/engine";
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
    noPattern([/@ts-ignore/, /eslint-disable/]),               // no suppressions
  ],
  async finish(results) {
    return { fixed: results.every((r) => r.ok) };
  },
});
```

This example is a simplified version of the real `fix-ci`, which defaults `command` to `pnpm check` and uses more gates.

Tasks can depend on each other. Independent tasks run in parallel, up to `maxWorkers`. When a task fails or is skipped, the engine skips every task that depends on it.

The built-in recipes live in [`@orchestra/recipes`](../recipes): `fix-ci`, `fix-lint`, `update-tests`, `repro-bug`, `pr-review`, `pr-describe`, and `add-component`, plus the `bug-to-pr` chain.

### Contract reference

| Hook | Signature | Called | Decides |
| --- | --- | --- | --- |
| `input` | `z.ZodType<Input>` | before anything runs | the shape of valid input |
| `plan` | `(input, ctx) => Promise<Task[]>` | once, after validation | which tasks exist and their dependencies |
| `worker` | `(task, ctx) => WorkerConfig` | once per task attempt | how that attempt's Claude call runs |
| `gates` | `Gate[]` | after each attempt | whether the attempt counts |
| `onFailed` | `(task, reasons, ctx) => Promise<void>` | when a task runs out of attempts | optional side effects, such as filing a report |
| `finish` | `(results, ctx) => Promise<Output>` | once, after all tasks | the run's `output` |

`defineRecipe({ ... })` returns its argument unchanged. It exists so TypeScript infers `Input` from the Zod schema and types `plan`, `worker`, and `finish`.

A `Task` is one unit of work. `context` holds your per-task data, which you read back in `worker` and in gates.

```ts
interface Task { id: string; goal: string; dependsOn: string[]; context: Record<string, unknown>; }
```

`worker()` returns a `WorkerConfig`, which the engine passes to `messenger.send()`:

| Field | Type | Description |
| --- | --- | --- |
| `prompt` | `string` | The task prompt. On a retry, the engine adds the previous attempt's rejection reasons to it. |
| `tools` | `string[]` | Allowed tools, such as `["Read", "Edit", "Bash(npm test)"]`. |
| `allowEdits` | `string[]` | Optional path globs the worker should stay within. The `onlyTouches` gate enforces them. |
| `maxTurns` | `number` | Optional cap on the worker's turns. |
| `model` | `string` | Optional model, such as `"sonnet"` or `"haiku"`. |
| `system` | `string` | Optional extra system prompt. |

The engine passes a `ctx: Ctx` to `plan`, `worker`, `onFailed`, and `finish`:

| Member | Type | Use |
| --- | --- | --- |
| `repo` | `string` | The target repo path. |
| `messenger` | `Messenger` | For recipes that run their own planner or triage call with `askJson`. |
| `signal` | `AbortSignal` | Aborted when the run is cancelled. |
| `emit` | `(event) => void` | Puts an event on the run's stream. |
| `exec` | `(cmd, opts?) => Promise<{ code, output }>` | Runs a command in the repo root, so `plan()` can check whether there is anything to do. |

A gate is `{ name, check(ctx) }`. `check` returns `{ ok: true }` or `{ ok: false, reasons }`. Its `GateContext` holds the evidence:

```ts
interface GateContext {
  worktree: string;       // the attempt's checkout
  task: Task;
  diff: string;           // staged diff against the attempt's base
  changedFiles: string[];
  output: string;         // the worker's final message, for read-only recipes
  exec(cmd, opts?): Promise<{ code; stdout; stderr }>; // runs a command in the worktree
}
```

## Chains

A chain runs other recipes as child runs and adds plain-code steps between them. It has no `plan`, `worker`, or `gates`. `bug-to-pr` is a chain.

```ts
import { defineChain } from "@orchestra/engine";
import { z } from "zod";

export const example = defineChain({
  name: "example",
  description: "Fix a command, then describe the change",
  input: z.object({ command: z.string() }),
  async run(input, ctx) {
    const fix = await ctx.run("fix-ci", { command: input.command });
    if (!fix.ok) return { status: "fix-failed" };
    const diff = fix.tasks[0]?.diff ?? "";
    const sha = await ctx.step("commit", () =>
      ctx.git.commit("orca/example", { diff, message: "fix: make the command pass" }),
    );
    return { status: "committed", sha };
  },
});
```

A chain's `run(input, ctx)` gets a `ChainCtx`, which is a `Ctx` plus these members:

| Member | Use |
| --- | --- |
| `run(name, input, opts?)` | Starts a child run and resolves to its `RunResult`. It never throws. `opts.base` picks the ref, and `opts.limits` can tighten the child's limits but never loosen them past the parent's. |
| `step(name, fn)` | Runs `fn` and emits `step.started` and `step.done` around it. |
| `git.commit(branch, { from?, diff, message })` | Applies a diff with `git apply --index` in a throwaway worktree and commits it to `branch`. Resolves to the commit sha. Your checkout never moves. |
| `git.push(branch)` | Pushes a branch. It only pushes `orca/*` branches. |
| `pr` | The engine's `PrSink`: `readIssue(n)`, `open({ branch, base, title, body, draft })`, and `comment(issue, body)`. |
| `runId` | The chain's run id. |

Child runs can nest up to 3 levels deep. A child run past that limit ends with `plan_failed`. If `run()` throws, the chain ends with `plan_failed` and the error message. A chain's `RunResult` has an empty `tasks` list. Its `output` is whatever `run()` returned.

### PR sinks

`githubSink({ repo, remote? })` uses `gh` and `git push` against the repo's remote, `origin` by default. `localSink({ dir })` writes issues, PRs, and comments as files under `dir`, so you can try a chain without touching GitHub. The `orca` CLI uses `<repo>/.orca` as the local sink's folder.

## Events and results

`run.events` yields typed `EngineEvent`s. Each event has a `type`, and narrowing on `type` gives you its fields.

| `type` | Fires when | Fields |
| --- | --- | --- |
| `run.started` | the job is accepted | `recipe`, `input` |
| `plan.ready` | the recipe has decided its tasks | `tasks: { id, goal, dependsOn }[]` |
| `approval.needed` | the run waits on `run.approve()`, only with `approvePlan` | `what`, such as `"plan"` |
| `task.started` | a worker attempt begins | `taskId`, `attempt`, `worktree` |
| `worker.event` | the worker's messenger emits an event | `taskId`, `event`, the raw `MessengerEvent` |
| `gate.passed` | a gate passed | `taskId`, `gate` |
| `gate.failed` | a gate failed | `taskId`, `gate`, `reasons` |
| `task.retrying` | gates failed and the task tries again | `taskId`, `attempt`, `reasons` |
| `task.done` | a task succeeded | `taskId`, `attempts`, `costUsd` |
| `task.failed` | a task used up its attempts | `taskId`, `reasons` |
| `task.skipped` | a dependency failed or was skipped | `taskId`, `reason` |
| `budget.warning` | the run reached 80% of a cap | `resource` (`"cost"` or `"duration"`), `used`, `limit` |
| `step.started`, `step.done` | a chain step starts or ends | `name` |
| `child.started` | a chain starts a child run | `childRunId`, `recipe` |
| `child.event` | the child run emits an event | `childRunId`, `recipe`, `event` |
| `child.done` | the child run ends | `childRunId`, `recipe`, `result` |
| `run.done` | the run ends | `result`, the `RunResult` |

`run.done`, the promise, resolves to a `RunResult`:

```ts
interface RunResult {
  ok: boolean;
  status: "completed" | "partial" | "failed" | "cancelled";
  output?: unknown;                 // what the recipe's finish() or the chain's run() returned
  tasks: { id; ok; attempts; costUsd; diff?; failures? }[];
  costUsd: number;
  durationMs: number;
  tracePath: string;
  error?: { kind: RunErrorKind; message: string };
}
```

`error.kind` is one of `unknown_recipe`, `invalid_input`, `plan_failed`, `finish_failed`, `budget`, `timeout`, or `cancelled`. A task whose gates never passed doesn't set `error`. It shows up in `tasks[].failures` and makes the status `partial` or `failed`.

## Gates

A recipe lists gates in `gates`. These ship with the engine:

| Gate | Fails when |
| --- | --- |
| `commandPasses(cmd)` | the command exits non-zero. The tail of its output becomes the reason. |
| `commandFails(cmd)` | the command exits 0. `repro-bug` uses it to require a test that fails on the current code. |
| `failsWithAssertion(command, parse)` | any failing test failed for a reason other than an assertion, or a second run fails a different set of tests. Catches crashes and flaky tests posing as a reproduction. |
| `failsOnBase(base, srcGlob, test)` | the changed tests still pass when the files matching `srcGlob` are reverted to the `base` commit. That means the tests don't check the change. |
| `countNotLess(pattern, files)` | a pattern, such as `expect(`, matches fewer times in a file than it did at `HEAD`. Stops a worker from deleting assertions. |
| `noPattern(regexes)` | a line the attempt added matches a pattern. Lines already in the file don't count. |
| `onlyTouches(globs)` | the attempt changed a file outside the allowed globs. |
| `noFileChanges(regexes)` | the attempt changed a file whose path matches a pattern. Use it to protect tests, config, and lockfiles. |
| `filesExist(paths)` | a required file is missing from the worktree. |
| `outputMatches(schema)` | the worker's final message isn't JSON that matches the Zod schema. For read-only recipes. |
| `anchoredInDiff(hunks)` | a review comment points at a line the diff didn't change. |
| `mentionsOnlyDiffFiles(files)` | the listed changes name a file outside the diff, or skip a changed file. |
| `closesIssue(issue)` | a PR description doesn't link the issue it was given. |
| `claimsMatchEvidence(evidence)` | a PR description claims testing that no recipe or passed gate backs up. |

`cmd`, `globs`, and similar arguments can also be functions of the task, so one recipe can read them from `task.context`. A gate is `{ name, check(ctx) }`, so a recipe can define its own inline. `add-component`'s `fileCreated` is an example.

## Testing

The automated suite uses a temporary git repo and a test messenger that edits the worktree, so it runs the whole loop without Claude or the network:

```bash
pnpm --filter @orchestra/engine test
pnpm --filter @orchestra/engine typecheck
```

Standalone check scripts print each stage as it runs:

```bash
pnpm --filter @orchestra/engine exec tsx scripts/check-skeleton.ts   # a diff comes back
pnpm --filter @orchestra/engine exec tsx scripts/check-gates.ts      # gates and retry
pnpm --filter @orchestra/engine exec tsx scripts/check-harden.ts     # validation, budget, cancel
pnpm --filter @orchestra/engine exec tsx scripts/check-scheduler.ts  # scheduler and approval
```

### A real end-to-end run

This drives Claude Code, so it needs a login. Point the demo at a scratch repo with a type error:

```bash
# make a throwaway repo with one type error
mkdir -p /tmp/orca-demo && cd /tmp/orca-demo
git init -q && git config user.email you@test.dev && git config user.name You
printf 'export const n: number = "not a number";\n' > index.ts
git add -A && git commit -qm initial

# from the orca repo, run fix-ci against it
cd -
pnpm --filter @orchestra/recipes demo /tmp/orca-demo "npx tsc --noEmit"
```

The script prints the event stream, the final `RunResult`, and the diff Claude produced. The work happens in worktrees under `/tmp/orca-demo/.orca/worktrees/`, and the repo's own checkout doesn't change. To run a recipe without writing a script, use the `orca` CLI from the repo root: `pnpm orca run fix-ci --repo /tmp/orca-demo --set command="npx tsc --noEmit"`.

## How it works

`engine.start()` calls `runRecipe`, which validates the input, plans, validates the task graph, waits for approval if asked, schedules, and finishes. `schedule` runs tasks in dependency order, up to `maxWorkers` at once, each through `runTask`. `runTask` is the retry loop. It creates a fresh worktree, calls the messenger, runs the gates, and then retries with feedback, finishes the task, or gives up. A `Budget` tracks cost and time, and an `AbortController` handles cancel. A chain goes through `runChain` instead, which validates input and calls the chain's `run()`. When `traceDir` is set, the engine appends every event to `events.jsonl` and writes the result to `summary.json`.

The design doc this package was built from is [Engine Design](https://claude.ai/artifact/BQUsq8wFy1DeeSVThPZTzy).
