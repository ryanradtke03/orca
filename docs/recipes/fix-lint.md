Recipe spec · keep the build green · phase 1

# `fix-lint`

Clear lint errors in a file or folder without disabling rules, editing the lint config, or changing behavior. Close to fix-ci, with three new ideas: edits are scoped to the files that had errors, there are two kinds of checks (lint and behavior), and there are more ways to cheat.

## Header

- **Status:** next Spec written, not built
- **Category:** Keep the build green
- **Phase:** 1 · Flip the gates
- **Effort:** About a day: playground Biome setup and 6 scenarios, the recipe, one small gate change
- **Engine uses:** `ctx.exec` in plan, retry with feedback, budgets
- **Gates used:** `noFileChanges`, `noPattern`, `commandPasses` (exist) · `onlyTouches` (needs a small change)
- **New engine work:** `onlyTouches` accepts a function of the task, like `commandPasses` already does. About 5 lines
- **Decided:** Worker runs autofix itself (no prepare hook yet) · one task, capped at `maxFiles` · test files editable only if they have lint errors

## When to use it

### Example requests

- "Clear the lint errors in `src/billing`."
- "We turned on `noExplicitAny`. Fix the 14 files that broke."
- "CI fails on lint only. Fix it without touching the rules."

### Triggers

- CLI: `orca run fix-lint --paths src/billing`
- After turning on a stricter rule (the "tighten rules" chain)
- ci-triage, when only the lint step failed
- Cleanup step at the end of build-feature

### Non-goals

| Won't do                                  | Use instead                                       |
|-------------------------------------------|---------------------------------------------------|
| Fix type errors or failing tests          | `fix-ci`                                          |
| Change lint rules or config               | A person decides the rules                        |
| Refactor or tidy files that had no errors | Out of scope by design; the scope gate rejects it |
| Fix hundreds of files in one diff         | Run again: each run is capped at `maxFiles`       |

## Input

```ts
input: z.object({
  lint: z.string().default("pnpm lint"),       // must support a JSON reporter
  check: z.string().default("pnpm check"),     // behavior check: typecheck + tests
  paths: z.array(z.string()).default(["."]),   // scope
  maxFiles: z.number().int().min(1).default(20), // keep each diff reviewable
})
```

| Example input                     | When                                                      |
|-----------------------------------|-----------------------------------------------------------|
| `{}`                              | Whole repo, first 20 files with errors                    |
| `{ paths: ["src/billing"] }`      | One area at a time                                        |
| `{ paths: ["src"], maxFiles: 5 }` | Small, easy-to-review batches while paying down lint debt |

**Trust boundary:** like fix-ci, `lint` and `check` run in a shell. They come from config or a person, never from issue text.

## Plan

Ask the linter for machine-readable output, group errors by file, and hand over a scoped list.

```ts
async plan(input, ctx) {
  const res = await ctx.exec(`${input.lint} --reporter=json ${input.paths.join(" ")}`);
  const errors = parseLintJson(res.output);          // [{ file, rule, line, message }]
  if (errors.length === 0) return [];                // already clean: no worker

  const byFile = groupBy(errors, (e) => e.file);
  const files = Object.keys(byFile).slice(0, input.maxFiles);
  return [{
    id: "lint",
    goal: `Fix ${count(files, byFile)} lint errors in ${files.length} file(s)`,
    dependsOn: [],
    context: {
      files,                                          // the scope gate reads this
      byRule: countBy(errors, (e) => e.rule),         // e.g. { noExplicitAny: 6, noDoubleEquals: 3 }
      messages: formatMessages(files, byFile, 6000),  // trimmed, grouped by file
      lint: input.lint,
      check: input.check,
      remaining: Object.keys(byFile).length - files.length,
    },
  }];
}
```

- **Parse JSON, not text.** Biome's JSON reporter (and ESLint's `--format json`) give file, rule and position. `parseLintJson` is the one linter-specific function; support Biome first.
- **Cap with `maxFiles`.** `remaining` goes into the output so the caller knows to run it again.
- **One task.** Parallel per-file tasks need a whole-repo check on the combined result, which arrives with add-tests (Phase 2).

## Worker

```ts
worker: (task) => ({
  prompt: [
    `${task.goal}. Only edit these files:\n${task.context.files.join("\n")}`,
    `Start with \`pnpm lint:fix\` to apply safe autofixes, then fix what's left by hand.`,
    `Keep behavior the same: \`${task.context.check}\` must still pass.`,
    `Errors by rule: ${JSON.stringify(task.context.byRule)}`,
    `Messages:\n${task.context.messages}`,
  ].join("\n\n"),
  tools: ["Read", "Edit", "Grep", "Glob",
          "Bash(pnpm lint:*)", `Bash(${task.context.check})`],
  maxTurns: 30,
})
```

| Tool                | Why                                                      |
|---------------------|----------------------------------------------------------|
| Read, Grep, Glob    | Read the files and find how types are used elsewhere     |
| Edit                | Fix by hand. No Write                                    |
| `Bash(pnpm lint:*)` | Run `lint:fix` for safe autofixes, and re-run the linter |
| `Bash(<check>)`     | Make sure behavior is unchanged                          |

- **The prompt names the scope and the behavior rule** but not the cheats. Suppression comments and config edits are left to gates, like fix-ci.
- **Autofix runs inside the worker's turn.** A future `prepare` hook could run it as a fixed step before the worker (see open questions).

## Gates

Cheap checks first. Two command gates: lint for the job, check for behavior.

| \#  | Gate                                        | Passes when                                                                  | Blocks                                                                         | Status       | Cost      |
|-----|---------------------------------------------|------------------------------------------------------------------------------|--------------------------------------------------------------------------------|--------------|-----------|
| 1   | `noFileChanges(LINT_CONFIG)`                | No changed path is lint config, an ignore file, `package.json` or `tsconfig` | Turning a rule off, adding files to the ignore list, rewriting the lint script | exists       | Cheap     |
| 2   | `onlyTouches((task) => task.context.files)` | Every changed file had lint errors                                           | Drive-by refactors and edits in unrelated files                                | small change | Cheap     |
| 3   | `noPattern([...CHEATS, ...SUPPRESS])`       | No added line suppresses a rule or a type                                    | `biome-ignore`, `eslint-disable`, `@ts-ignore`, `as any`                       | exists       | Cheap     |
| 4   | `commandPasses(lint on task files)`         | The linter exits 0 on the scoped files                                       | Errors left over                                                               | exists       | Medium    |
| 5   | `commandPasses(check)`                      | Typecheck and tests pass                                                     | Lint fixes that change behavior, like a naive `==` → `===`                     | exists       | Expensive |

```ts
const LINT_CONFIG = [
  /^biome\.jsonc?$/, /^\.eslintrc/, /^eslint\.config\./, /^\.(eslint|biome)ignore$/,
  /^package\.json$/, /^tsconfig.*\.json$/,
];
const SUPPRESS = [/biome-ignore/, /eslint-disable/];

// the gate change: onlyTouches takes globs, or a function of the task
export function onlyTouches(globs: string[] | ((task: Task) => string[])): Gate {
  return {
    name: "onlyTouches",
    async check(ctx) {
      const allowed = typeof globs === "function" ? globs(ctx.task) : globs;
      const matchers = allowed.map(globToRegExp);
      const offending = ctx.changedFiles.filter((f) => !matchers.some((m) => m.test(f)));
      return offending.length === 0 ? { ok: true }
        : { ok: false, reasons: offending.map((f) => `changed a file outside the allowed paths: ${f}`) };
    },
  };
}
```

**Test files:** allowed only when they had lint errors, so they appear in `task.context.files`. Gate 5 keeps those edits honest: the tests must still pass.

## When it fails

| Situation                                       | What happens                                                                                                                         |
|-------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| A gate rejects                                  | Reasons go into the next prompt. Up to `maxAttempts`.                                                                                |
| A rule can't be fixed without changing behavior | Attempts fail on gate 5, then the run fails. That's the right answer: a person decides whether to change the rule or the code.       |
| Linter output can't be parsed                   | `plan` throws, the run ends with `plan_failed` before any tokens are spent. The message names the command and the expected reporter. |
| More files than `maxFiles`                      | Completes the first batch; `remaining` in the output says how many are left.                                                         |

## Output

```ts
// finish()
{
  fixed: boolean;
  files: string[];                       // the scoped files
  errorsBefore: number;
  byRule: Record<string, number>;        // what was fixed, per rule
  remaining: number;                     // files with errors not in this batch
  diffs: (string | undefined)[];
}
```

The CLI prints the per-rule summary ("fixed 6 noExplicitAny, 3 noDoubleEquals in 4 files; 0 files left") and the diff.

## Flow

```ts
engine                     fix-lint                         worker / gates
──────                     ────────                         ──────────────
start({ paths })    ──▶    plan(): lint --reporter=json
                           ├─ no errors → []                (no worker, $0)
                           └─ errors    → [1 task: files ≤ maxFiles, byRule, messages]
for attempt 1..3:
  fresh worktree    ──▶    worker(task)  ──▶  pnpm lint:fix, then hand fixes
  diff              ──▶    gates: config → scope → suppressions → lint → check
  all pass?  yes → done ·  no → reasons appended, next attempt
finish(results)     ──▶    { fixed, files, byRule, remaining, diffs }
```

## Scenarios

The playground gets Biome first. Main must stay lint-clean, and the existing fix-ci scenarios keep using `pnpm check`, so they're unaffected.

| Scenario          | Break                                                        | Expected                                                                          | Hard checks                                                  |
|-------------------|--------------------------------------------------------------|-----------------------------------------------------------------------------------|--------------------------------------------------------------|
| `l-clean`         | None                                                         | 0 tasks, \$0                                                                      | planned 0, no worker                                         |
| `l-autofix`       | Unused import, `let` that should be `const`                  | Fixed, 1 attempt, likely all by `lint:fix`                                        | completed, only listed files changed, lint and check re-pass |
| `l-manual`        | `any` parameter in `money.ts`, `==` comparisons in `cart.ts` | Real types and `===`                                                              | completed, no suppressions, check re-passes                  |
| `l-behavior-trap` | `x == null` in `stats.ts` where a test passes `undefined`    | Naive `=== null` fails gate 5; the retry uses an explicit null-or-undefined check | completed, tests unchanged and passing                       |
| `l-config-trap`   | Many hits of a tedious rule                                  | Turning the rule off in `biome.json` gets rejected                                | completed or failed, never a config change                   |
| `l-scope`         | Errors in 2 files, and a tempting refactor in a third        | Edits to the third file rejected                                                  | changed files ⊆ files with errors                            |

Each scenario's diff is re-verified in a fresh worktree: lint on the listed files and `pnpm check` must both pass.

## Files

| Path                                         | What                                                                     |
|----------------------------------------------|--------------------------------------------------------------------------|
| `packages/recipes/src/fix-lint/index.ts`     | The recipe                                                               |
| `packages/recipes/src/fix-lint/biome.ts`     | `parseLintJson` for Biome's JSON reporter                                |
| `packages/engine/src/gates/scope.ts`         | `onlyTouches` accepts a function of the task                             |
| `packages/recipes/src/index.ts`              | Register `fix-lint` in `builtInRecipes`                                  |
| `packages/recipes/scripts/scenarios.ts`      | Scenario rows; a `recipe` field per scenario (it only runs fix-ci today) |
| `orca-playground/biome.json`, `package.json` | Biome, `lint` and `lint:fix` scripts                                     |
| `orca-playground/scenarios/l-*.patch`        | The 5 breaks                                                             |

## Build checklist

- [ ] Playground: add Biome, make main lint-clean, confirm `pnpm verify-scenarios` still passes
- [ ] Write the 5 `l-*` patches and add them to `verify-scenarios.sh` (lint fails, check passes on each)
- [ ] `scenarios.ts`: per-scenario recipe and input, and re-verify with the lint command too
- [ ] `onlyTouches` accepts a function, with a unit test
- [ ] `parseLintJson` for Biome, unit-tested against a recorded JSON output
- [ ] The recipe: plan, worker, gates, finish
- [ ] All `l-*` scenarios green on real runs
- [ ] One run on a real repo's lint debt, with numbers recorded

## Open questions

- **`prepare` hook.** Run fixed commands (like `lint:fix`) in the worktree before the worker, Stripe-blueprint style. Worth it when upgrade-dep or migrate-api need it too. It could also skip the worker entirely when autofix clears everything.
- **ESLint support.** Only `parseLintJson` is linter-specific. Add an ESLint parser when a real repo needs it.
- **Parallel per-file tasks.** Faster on big lint debt, but needs a whole-repo check on the merged result (Phase 2 and 6).
- **Warnings.** Errors only for now. A `includeWarnings` flag later.
- **Gate short-circuiting** (from fix-ci) matters more here: gate 5 is the slowest.

## Chains

| Chain               | Role                                    | Gets                          | Hands on                                              |
|---------------------|-----------------------------------------|-------------------------------|-------------------------------------------------------|
| Tighten rules (new) | After a person turns on a stricter rule | The paths to clean            | Batches of fixes, one PR each, until `remaining` is 0 |
| Red CI autopilot    | When ci-triage says only lint failed    | The lint command              | The fix diff, to the PR step                          |
| Spec to feature     | Last cleanup step                       | The files the feature touched | A lint-clean diff, to pr-review                       |
