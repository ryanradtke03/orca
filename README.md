# Orca

Orca drives Claude Code to do gated work in a git repo. It can reproduce a bug, fix a failing command, write a PR description, or review a branch, and then open a draft PR. Each job runs in its own git worktree, and code checks decide whether the work counts. Your checkout never moves.

The project has three parts. The engine handles worktree isolation, a task graph, quality gates that retry with feedback, cost and time budgets, child runs, and a typed event stream that never throws. Recipes describe each job. The `orca` CLI connects the two so you can run a recipe from a terminal.

The product and its binary are called `orca`, and per-repo runtime state lives under `.orca/`. The npm packages keep their original `@orchestra/*` scope.

## Status

Built and tested:

- The engine, with worktrees, a scheduler, gates, budgets, child runs capped at depth 3, and a JSONL trace per run. [`packages/engine/README.md`](packages/engine/README.md) documents the API.
- Seven recipes: `fix-ci`, `fix-lint`, `update-tests`, `repro-bug`, `pr-review`, `pr-describe`, and `add-component`.
- The `bug-to-pr` chain. It runs `repro-bug`, then `fix-ci`, then `pr-describe` and `pr-review` in parallel, and opens one draft PR.
- The CLI (`@orchestra/cli`), with the commands `init`, `list`, `describe`, `run`, `doctor`, and `runs`.

Not built yet:

- An MCP server. `packages/mcp` is an empty folder.
- The Electron desktop app. `apps/desktop` is an empty folder.
- `packages/shared`, which is meant to hold code that several recipes reuse. It has empty subfolders and no code.
- Recipes beyond the current seven.
- A compiled standalone binary. The CLI runs its TypeScript source through `tsx`.
- A runnable `examples/scratch-repo` fixture. That folder is empty.

The config loader and engine factory live in their own modules so the MCP server and desktop app can reuse them.

## Quickstart

You need Node 20 or later, pnpm, and [Claude Code](https://code.claude.com) installed and logged in. From the repo root:

```bash
pnpm install
pnpm orca doctor               # checks that Claude Code is installed and logged in
pnpm orca init --yes           # writes a per-repo .orca.json
pnpm orca list                 # lists the recipes and the bug-to-pr chain, no spend
pnpm orca describe bug-to-pr   # prints that recipe's JSON input schema, no spend

# A real run. It spends usage on your Claude subscription. The default local
# sink writes the PR to .orca/ instead of opening one on GitHub.
pnpm orca run bug-to-pr --set report="median([1,2,3,4]) returns 3, should be 2.5"
```

## Commands

| Command | What it does | Spends usage? |
| --- | --- | --- |
| `orca init [--base <ref>] [--github [--remote <name>]] [--yes] [--force]` | Writes a per-repo `.orca.json`. Detects the git root, base branch, `gh` login, and package manager. | no |
| `orca list [--json]` | Lists recipes and chains with their descriptions. | no |
| `orca describe <recipe>` | Prints a recipe's JSON input schema. | no |
| `orca run <recipe> [--set k=v]... [--input-json '<json>'] [--base <ref>] [--verbose]` | Starts a run, streams its events to stderr, and prints the result to stdout. | yes |
| `orca doctor` | Reports whether Claude Code is installed, logged in, and on a subscription. | one small prompt |
| `orca runs [--limit <n>] [--json]` | Lists past runs from the trace folder, newest first. | no |

Every command except `doctor` accepts `--repo <path>` to pick the target repo, and `--github` to use the GitHub PR sink instead of the local one. All of them except `doctor` and `init` accept `--config <path>` to load a specific config file.

`run` sends progress to stderr and the result to stdout. The exit code is 0 on success, 1 for a usage or config error, and 2 when a run fails.

`--set` parses each value as JSON when it can, so `--set issue=42` passes the number 42 and `--set report=hi` passes the string `"hi"`. `--set` values override keys from `--input-json`.

## Targeting a repo

Orca acts on the current working directory, the same way `git` does. `--repo <path>` overrides it. Link the binary once to use it from any folder:

```bash
pnpm link --global          # once, from the repo root
cd ~/code/some-project && orca run fix-ci
```

`pnpm orca ...` always runs with its working directory set to this repo, because pnpm runs scripts from the folder that defines them. To act on another repo through pnpm, pass `--repo`. The globally linked `orca` uses the folder you run it from. `orca run` prints the resolved repo path to stderr before it starts, so you can confirm the target.

## Configuration

With no config file, the target repo is the working directory, PRs go to a local file sink under `.orca/`, and the messenger uses the Claude Code CLI. `orca init` pins the few values Orca can't safely guess into a minimal `.orca.json`. It writes only fields that differ from the defaults:

```json
{ "base": "main", "pr": { "kind": "github" } }
```

Orca looks for the config file in the root of the target repo. It reads `orca.config.ts` if it exists, and otherwise `.orca.json`. `--config <path>` points at a specific file instead. Flags override the file, and the file overrides the defaults.

### Every field

All fields are optional. This `.orca.json` sets every one of them:

```json
{
  "base": "main",
  "pr": { "kind": "github", "remote": "upstream" },
  "backend": "cli",
  "limits": {
    "maxWorkers": 2,
    "maxAttempts": 3,
    "maxCostUsd": 2.5,
    "maxDurationMs": 1200000
  },
  "traceDir": ".orca/traces",
  "worktreeDir": "/abs/path/to/repo/.orca/worktrees",
  "keepWorktrees": "on-failure"
}
```

| Field | Allowed values | Default |
| --- | --- | --- |
| `repo` | a path | the `--repo` flag, or the current folder |
| `base` | a branch or commit | `HEAD`. `--base` overrides it for one run. |
| `pr` | `{ "kind": "local", "dir": "..." }` or `{ "kind": "github", "remote": "..." }`. `dir` and `remote` are optional. | the local sink, writing to `<repo>/.orca`. `--github` switches to GitHub. |
| `backend` | `"cli"` | `"cli"`. The schema also accepts `"fake"`, but Orca rejects it at run time because it only works with test fixtures. |
| `limits` | any of `maxWorkers`, `maxAttempts`, and `maxDurationMs` as positive whole numbers, and `maxCostUsd` as a positive number | 2 workers, 3 attempts, $3, and 30 minutes |
| `traceDir` | a path, resolved relative to the repo | `<repo>/.orca/traces` |
| `worktreeDir` | an absolute path | `<repo>/.orca/worktrees` |
| `keepWorktrees` | `"always"`, `"on-failure"`, or `"never"` | `"on-failure"` |

`maxDurationMs` is in milliseconds, so `1200000` is 20 minutes. A bad value stops the command with one error line naming the field, such as `invalid config: limits.maxWorkers: ...`, and exit code 1.

### TypeScript config

`orca.config.ts` holds the same fields as a default export:

```ts
export default {
  base: "main",
  pr: { kind: "github" },
  limits: { maxCostUsd: 1.5 },
};
```

The CLI has a `defineConfig` helper in `packages/cli/src/config.ts`, but `@orchestra/cli` doesn't export it yet. From another repo, use a plain object as shown above.

## Package layout

```
packages/
├── engine/      @orchestra/engine     runs jobs; knows nothing about specific recipes
├── messenger/   @orchestra/messenger  runs Claude Code and streams its output; checkClaude()
├── recipes/     @orchestra/recipes    the seven recipes and the bug-to-pr chain
├── cli/         @orchestra/cli        the orca binary
├── shared/      empty, roadmap
└── mcp/         empty, roadmap
apps/
└── desktop/     empty, roadmap
```

## Development

```bash
pnpm typecheck    # tsc across all packages
pnpm test         # vitest
pnpm check        # biome
```
