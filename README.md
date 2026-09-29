# Orchestra

An engine for running **recipes** — repeatable, gated jobs that drive Claude to do
real work in a repo (fix CI, add a component, etc.). The engine handles control
flow (task graphs, git worktrees, gates, budgets); recipes describe the job; a CLI
and an Electron desktop app drive it.

## Project structure

```
orchestra/
├── package.json                 root scripts, dev deps (typescript, vitest, biome, tsx)
├── pnpm-workspace.yaml          packages/*, apps/*
├── tsconfig.base.json           shared strict TS settings
├── biome.json
├── .gitignore                   node_modules, dist, .orchestra/runs, .orchestra/worktrees
├── docs/
│   ├── architecture.md
│   └── recipes/                 one spec per recipe (the recipe spec template)
│       ├── fix-ci.md
│       └── add-component.md
│
├── packages/
│   ├── messenger/               talks to Claude: cli / sdk / openai-compat / fake backends
│   │   ├── src/
│   │   │   ├── types.ts         MessengerRequest, MessengerEvent, Messenger
│   │   │   ├── normalize.ts     Claude messages → MessengerEvent
│   │   │   ├── helpers.ts       ask(), conversation(), askJson()
│   │   │   ├── backends/
│   │   │   │   ├── cli.ts       spawn `claude -p --output-format stream-json`
│   │   │   │   ├── fake.ts      replay saved event streams
│   │   │   │   ├── openaiCompat.ts   talk-only, free testing
│   │   │   │   └── sdk.ts       later, Agent SDK
│   │   │   └── index.ts
│   │   └── fixtures/            saved real event streams (.jsonl) for tests
│   │
│   ├── engine/                  control flow; knows nothing about specific recipes
│   │   └── src/
│   │       ├── types.ts         Recipe, Task, Gate, TaskResult, EngineEvent, Config
│   │       ├── engine.ts        createEngine(), start(recipe, input) → Run
│   │       ├── run.ts           Run: events(), done, approve()
│   │       ├── scheduler.ts     task graph, deps, worker cap
│   │       ├── workspace.ts     git worktree create / diff / merge / remove
│   │       ├── gates.ts         runGates(), retry-with-feedback
│   │       ├── budget.ts        cost / step / time caps
│   │       ├── events.ts        typed emitter + JSONL trace writer
│   │       ├── config.ts        load .orchestra/config.ts (Zod-validated)
│   │       └── index.ts
│   │
│   ├── shared/                  reusable building blocks for recipes
│   │   └── src/
│   │       ├── agents/          conventions-scout, planner, reviewer, triage
│   │       ├── discover/        facts, conventions cache, examples
│   │       └── gates/           filesExist, noPattern, command, fromConventions
│   │
│   ├── recipes/                 the jobs
│   │   └── src/
│   │       ├── fix-ci/          index.ts, prompts.ts, gates.ts
│   │       ├── add-component/
│   │       └── index.ts         registry: { "fix-ci": fixCi, ... }
│   │
│   ├── cli/                     `orchestra run <recipe> --flags`
│   │   └── src/index.ts         commander, picocolors, ora
│   │
│   └── mcp/                     later: run_recipe / run_status for Claude Code
│
├── apps/
│   └── desktop/                 Electron (electron-vite)
│       ├── electron.vite.config.ts
│       └── src/
│           ├── main/            Node side: hosts the engine, spawns Claude
│           │   ├── index.ts     window setup
│           │   └── ipc.ts       startRun, approve, listRuns → engine; forwards events
│           ├── preload/
│           │   └── index.ts     contextBridge: window.orchestra = { startRun, onEvent, approve }
│           └── renderer/        React UI: runs list, live task graph, logs, diffs
│               ├── index.html
│               └── src/
│                   ├── App.tsx
│                   ├── pages/   NewRun, RunView, History
│                   └── components/
│
└── examples/
    └── scratch-repo/            tiny repo with deliberate breakage, for testing recipes
```

## Status

Scaffolding — directory structure in place. Files not yet implemented.
