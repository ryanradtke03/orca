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

```ts
createEngine(config)            → engine        // one per app
engine.start(recipe, input, opts?) → run        // starts immediately
engine.recipes()                → RecipeInfo[]  // name, description, JSON schema
engine.runs()                   → RunSummary[]  // past runs, from traceDir
engine.get(runId)               → run | undefined  // a live run, to reattach

run.id                          // also the trace folder name
run.events                      → AsyncIterable<EngineEvent>
run.done                        → Promise<RunResult>   // always resolves
run.cancel()                    // kills workers, cleans worktrees, ends "cancelled"
run.approve(ok)                 // answers an approval.needed event
```

### `createEngine(config)`

| Option | Default | Description |
| --- | --- | --- |
| `repo` | required | git repo the engine works on |
| `messenger` | required | any `Messenger` (CLI, scripted, later SDK) |
| `recipes` | required | `Record<name, Recipe>` registry |
| `limits.maxWorkers` | `2` | tasks running at the same time |
| `limits.maxAttempts` | `3` | worker attempts per task before giving up |
| `limits.maxCostUsd` | `3` | per run; the run stops when reached |
| `limits.maxDurationMs` | `30 min` | per run |
| `worktreeDir` | `.orchestra/worktrees` | where task worktrees go (gitignored) |
| `traceDir` | _none_ | if set, write `events.jsonl` + `summary.json` per run |
| `keepWorktrees` | `"on-failure"` | `"always" \| "on-failure" \| "never"` |

`start()` also takes `opts`: `signal` (an `AbortSignal` to cancel), `approvePlan` (pause for `run.approve()`), and per-run `limits`.

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

---

## Events & results

`run.events` streams typed `EngineEvent`s: `run.started`, `plan.ready`, `approval.needed`, `task.started`, `worker.event` (the messenger's own events, tagged with a task id), `gate.passed` / `gate.failed`, `task.retrying`, `task.done` / `task.failed` / `task.skipped`, `budget.warning`, and finally `run.done`.

`run.done` resolves to a `RunResult`:

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
