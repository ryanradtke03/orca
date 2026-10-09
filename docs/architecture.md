Architecture · how the pieces fit · the engine↔recipe loop

# Architecture

How Orca is put together, and what actually happens when a recipe runs. The per-recipe shape lives in [the catalog](./recipe-catalog.md); this doc is the runtime around it.

## The four packages

The dependency spine is strict and one-directional: `messenger ← engine ← recipes ← cli`. Messenger knows nothing about the engine; the engine knows nothing about any concrete recipe.

```
┌────────────────────────────────────────────────────────────────────┐
│  cli  (@orchestra/cli)                            ⚠ empty stub today │
│  Planned entry point: parse args → createEngine({ messenger })       │
│  → register recipes → run one, stream EngineEvents to the terminal   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ depends on ▼
┌────────────────────────────────────────────────────────────────────┐
│  recipes  (@orchestra/recipes)        deps: engine, messenger, zod   │
│  The catalog of concrete jobs:                                       │
│    repro-bug · fix-ci · fix-lint · update-tests · add-component      │
│    pr-describe · pr-review · bug-to-pr (a CHAIN composing the above) │
│  Each defineRecipe: plan() → worker() → gates → finish()             │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ built on ▼
┌────────────────────────────────────────────────────────────────────┐
│  engine  (@orchestra/engine)             deps: messenger, zod        │
│  The orchestration runtime. createEngine({ messenger, limits… }):    │
│    plan → scheduler/queue → per-task git WORKTREE → worker →         │
│    gates (verify) → retry with feedback → finish                     │
│    + budget, tracer, PrSink (github|local), chains (shared budget)   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ drives Claude through ▼
┌────────────────────────────────────────────────────────────────────┐
│  messenger  (@orchestra/messenger)                   deps: zod only  │
│  The Claude adapter — lowest layer, no orchestration knowledge.      │
│    Messenger.send(req) → MessengerRun { events (stream), done }      │
│    CliMessenger → spawns the `claude` binary                         │
│    FakeMessenger → replays .jsonl fixtures (tests)                   │
│    done event carries: ok, text, sessionId, costUsd, turns           │
└──────────────────────────────┬───────────────────────────────────────┘
                               ▼
                     the `claude` CLI process
```

- **messenger** turns a `MessengerRequest` into a spawned `claude` process and streams events back, ending in a `done` with cost/session. The backend is swappable (real CLI vs. fixtures), so the engine never spawns a process itself.
- **engine** owns all the machinery: validating input, planning, running tasks concurrently in isolated git worktrees, verifying with gates, retrying, enforcing a budget, opening PRs via a `PrSink`, recording traces.
- **recipes** are the only package that names concrete jobs. `bug-to-pr` is a chain that wires `repro-bug → fix-ci → (pr-describe ∥ pr-review) → open PR`.
- **cli** is an empty `src/` today. Until it lands, a run starts programmatically: `createEngine({ messenger }).run(name, input)`.

## The engine↔recipe contract

Interaction is inversion of control: a recipe is a passive object of hooks, and the engine is the driver that calls those hooks in a fixed order. **The recipe decides; the engine runs everything.** A recipe never calls the engine.

A recipe (`packages/engine/src/types.ts`, `Recipe`) is five things the engine asks for:

```ts
interface Recipe<Input, Output> {
  input:  z.ZodType<Input>;                 // schema, validated before anything runs
  plan:   (input, ctx) => Promise<Task[]>;  // what work exists
  worker: (task,  ctx) => WorkerConfig;      // the prompt + tools for one task
  gates:  Gate[];                            // code that grades the worker's output
  finish: (results, ctx) => Promise<Output>; // fold task results into the answer
  onFailed?(task, reasons, ctx);             // optional
}
```

`defineRecipe()` (`packages/engine/src/recipe.ts`) is a typed identity function — it does nothing at runtime, it only lets `plan`/`worker`/`finish` infer the input type from the Zod schema.

The recipe receives a `Ctx` (`types.ts`, `Ctx`) with `messenger`, `exec`, `emit`, `signal`, but it only *reads* from it (e.g. `ctx.exec` in `plan()` to check whether there's work). Worktree creation, the actual `messenger.send`, cost accounting, retries, and cleanup are all the engine's.

### The driver — `runRecipe()` (`packages/engine/src/lifecycle.ts`)

```
1. recipe exists?            → else unknown_recipe
2. recipe.input.safeParse()  → else invalid_input   (nothing runs on bad input)
3. tasks = recipe.plan(input, ctx)
4. validateGraph(tasks) + optional plan approval
5. schedule(tasks, runTask, ctx)   ← respects maxWorkers + dependsOn
6. budget/cancel short-circuits → partial / cancelled  (no finish())
7. output = recipe.finish(results, ctx) → status: completed | partial | failed
```

Every exit — including a throw inside the recipe's own hooks — is caught and turned into a clean `RunResult`.

### Chains differ

A `Chain` (like `bug-to-pr`) is registered alongside recipes but has no `plan`/`worker`/`gates`. Its `run(input, ctx)` gets a richer `ChainCtx` (`types.ts`, `ChainCtx`) with `run` (start a child recipe), `git`, `pr`, and `step()`. A chain interacts with the engine by launching other runs through `ctx.run(...)`, each going through the full `runRecipe → runTask` loop, all sharing one budget.

## A full trace: `fix-ci`

Input: `{ command: "pnpm check" }`. Recipe source: `packages/recipes/src/fix-ci/index.ts`. Each line is labeled by who acts.

```
user:      run "fix-ci" with { command: "pnpm check" }
           (today: createEngine({ messenger }).run("fix-ci", { command: "pnpm check" }))
```

### Setup & validation — `runRecipe()`

```
engine:    look up "fix-ci"                     → found ✓   (else unknown_recipe)
engine:    emit { type: "run.started" }         → user sees it start
engine:    fixCi.input.safeParse(…)             → valid ✓   (else invalid_input)
engine:    ensureExcluded(repo)                 (gitignore the worktree dir)
```

### plan() — the recipe decides if there's work

```
engine:    call fixCi.plan(input, ctx)
recipe:      ctx.exec("pnpm check")       ← recipe asks the ENGINE to run it in repo root
engine:        runs it, returns { code, output }
recipe:      code !== 0 → build ONE task:
               { id:"fix", goal:"Make `pnpm check` pass",
                 context:{ command, failure: tail(output, 6000) } }
           ── if code === 0 → return [] → no worker, straight to finish ──
engine:    validateGraph([fix])  → ok
engine:    emit { type:"plan.ready", tasks:[fix] }   → user sees the plan
engine:    optional plan approval — skipped unless approvePlan is set
```

### schedule → runTask() — the attempt loop (`packages/engine/src/task.ts`), maxAttempts=3

Attempt 1:

```
engine:    createWorktree(repo, runId, "fix", attempt=1)   ← isolated git checkout
engine:    emit { type:"task.started", worktree }

engine:    call fixCi.worker(task, ctx)
recipe:      return WorkerConfig {
               prompt: "Make `pnpm check` pass… Current failure:\n```\n<failure>\n```",
               tools:  [Read, Edit, Grep, Glob, Bash(pnpm check), Bash(pnpm test:*), …],
               maxTurns: 25 }                              ← recipe only produces the prompt

engine:    messenger.send({ prompt, cwd: worktree, tools, maxTurns, signal })
messenger:   spawn the `claude` binary in the worktree
claude:        reads files, edits source, runs `pnpm check` itself, iterates…
messenger:   stream events  → engine re-emits each as { type:"worker.event" } → user
messenger:   done → { ok:true, text, costUsd, sessionId }
engine:    budget.add(costUsd)                             ← engine owns cost accounting
engine:    getDiff(worktree)  → { patch, changedFiles }
```

### gates — code grades the work (the worker never grades itself)

```
engine:    runGates(fixCi.gates, gateCtx)
           gateCtx = { worktree, diff, changedFiles, output, exec }
recipe-gate: noFileChanges(TEST_AND_CONFIG)  → did the diff touch *.test.*, tsconfig,
             package.json?   (cheap: filenames only)
recipe-gate: noPattern(CHEATS)               → were @ts-ignore / as any / .skip( added?
             (cheap: added lines only)
recipe-gate: commandPasses(task => "pnpm check")
engine:        gate calls gateCtx.exec("pnpm check") INSIDE the worktree  (expensive)
```

Branch A — all gates pass (`reasons` empty):

```
engine:    emit { type:"task.done", attempts:1, costUsd }
engine:    return TaskResult { ok:true, diff, output, worktree }
```

Branch B — a gate fails (e.g. Claude added `as any`, or `pnpm check` still red):

```
engine:    feedback = reasons   (e.g. ["added forbidden pattern: as any"])
engine:    emit { type:"task.retrying", attempt:1, reasons }
engine:    removeWorktree(attempt 1)
engine:    ── Attempt 2 ──
engine:    worker() again; withFeedback() prepends to the prompt:
             "Your previous attempt was rejected. Fix these problems and try again:
              - added forbidden pattern: as any"           ← engine loops gate reasons back to Claude
           … same messenger → claude → gates loop, up to maxAttempts (3) …
           if still failing:
engine:    call fixCi.onFailed?(…)  → fix-ci has none, skip
engine:    emit { type:"task.failed", reasons }
engine:    return TaskResult { ok:false, failures:reasons }
```

### finish() — recipe folds results into the answer

```
engine:    cleanupWorktrees()   (keepWorktrees policy: drop on success, etc.)
engine:    call fixCi.finish(results, ctx)
recipe:      return { fixed: results.every(r => r.ok),   ← [] already-green also → true
                      diffs: results.map(r => r.diff) }
engine:    decide status from results: completed | partial | failed
engine:    return RunResult { ok, status, output, costUsd, durationMs, tracePath }

user:      receives RunResult → { ok:true, status:"completed",
                                  output:{ fixed:true, diffs:[<patch>] } }
```

### Who does what

| Actor | Does |
|---|---|
| **user** | names the recipe + input; gets a `RunResult`; sees streamed events |
| **engine** | validates input, calls `plan`/`worker`/`gates`/`finish`, makes worktrees, accounts budget, retries with feedback, decides final status — owns all machinery |
| **recipe** | *decides*: is there work (`plan`), what to tell Claude (`worker`), what counts as success (`gates`), what to return (`finish`) — runs nothing itself |
| **messenger** | turns `worker`'s prompt into a spawned `claude` process; streams events; reports `ok`/`costUsd` |
| **claude** | reads/edits code and runs the command inside the isolated worktree |

The point `fix-ci` makes: `worker()` only *asks* Claude to make the command pass — it's the **gates** (`commandPasses`) that independently re-run `pnpm check` in the worktree to verify it, and `noFileChanges`/`noPattern` that stop Claude cheating by editing tests or adding `as any`. The engine is what loops that verification back into the next prompt.
