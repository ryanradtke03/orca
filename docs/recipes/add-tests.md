Recipe spec · testing · phase 2

# `add-tests`

Write tests for code that has none, one file per task, in parallel. The tests have to pass, raise coverage, and catch real breakage: the recipe breaks the source on purpose and the new tests must notice.

## Header

- **Status:** planned Spec written, not built
- **Category:** Testing
- **Phase:** 2 · Tests that test
- **Effort:** 2–3 days: coverage setup, mutation gate, parallel scenarios
- **Engine uses:** First real use of parallel tasks (`maxWorkers`), `onlyTouches` with a function, `countNotLess`
- **Gates used:** `onlyTouches`, `noPattern`, `commandPasses`, `countNotLess` (from update-tests)
- **New engine work:** Two gates: `coverageAtLeast` and `mutationKills`. Check that parallel worktree creation doesn't race on `.git/index.lock`

## When to use it

### Example requests

- "`src/text.ts` has no tests. Write them."
- "Raise coverage on the 5 least-covered files."
- "Before we migrate this module, pin down its current behavior with tests."

### Triggers

- CLI: `orca run add-tests --files src/text.ts`
- Nightly cron: `{ auto: { below: 60, max: 5 } }`
- The "safety net first" chain before migrate-api
- A step in build-feature for new code

### Non-goals

| Won't do                                 | Use instead                                                                                            |
|------------------------------------------|--------------------------------------------------------------------------------------------------------|
| Fix bugs it finds                        | Tests describe current behavior. Suspected bugs are reported (see open questions); `fix-ci` fixes them |
| Update tests that already exist and fail | `update-tests`                                                                                         |
| End-to-end or browser tests              | `e2e-from-flow`                                                                                        |
| Chase 100% coverage                      | A threshold per file is the goal                                                                       |

## Input

```ts
input: z.object({
  files: z.array(z.string()).optional(),                 // explicit targets
  auto: z.object({                                       // or: let plan pick
    below: z.number().default(60),                       // line coverage %
    max: z.number().int().default(5),
  }).optional(),
  test: z.string().default("pnpm vitest run"),
  coverageTarget: z.number().default(80),                // % per file
  mutants: z.number().int().default(6),                  // breakages to try per file
  minKillRate: z.number().default(0.66),                 // share the tests must catch
}).refine((i) => i.files || i.auto, "give files or auto")
```

| Example input                                             | When                        |
|-----------------------------------------------------------|-----------------------------|
| `{ files: ["src/text.ts"] }`                              | One known gap               |
| `{ auto: { below: 60, max: 5 } }`                         | Coverage push               |
| `{ files: ["src/billing/invoice.ts"], minKillRate: 0.8 }` | Critical code, stricter bar |

## Plan

Measure coverage once, pick targets, and make one independent task per file so they run in parallel.

```ts
async plan(input, ctx) {
  const cov = await ctx.exec(`${input.test} --coverage --coverage.reporter=json-summary`);
  const summary = parseCoverageSummary(cov.output);     // { "src/text.ts": 0, "src/cart.ts": 92, ... }

  const targets = input.files
    ?? Object.entries(summary)
         .filter(([, pct]) => pct < input.auto!.below)
         .sort(([, a], [, b]) => a - b)
         .slice(0, input.auto!.max)
         .map(([file]) => file);
  if (targets.length === 0) return [];                  // nothing under the bar

  return targets.map((file) => ({
    id: slug(file),                                     // "src-text-ts"
    goal: `Write tests for ${file}`,
    dependsOn: [],                                      // independent: runs in parallel
    context: {
      file,
      testFile: testPathFor(file),                      // existing or new, e.g. test/text.test.ts
      exists: existsSync(testPathFor(file)),
      coverageBefore: summary[file] ?? 0,
      example: pickExampleTest(),                       // a good existing test to copy the style of
      ...input,
    },
  }));
}
```

- **One task per file, no `dependsOn`.** The scheduler runs up to `maxWorkers` at once. Each task writes a different test file, so the diffs never overlap.
- **Style example.** Pointing the worker at one well-written existing test keeps the new ones consistent with the repo.

## Worker

```ts
worker: (task) => ({
  prompt: [
    `${task.goal}. Put them in ${task.context.testFile}`
      + (task.context.exists ? " (extend it; keep every existing test)." : " (new file)."),
    `Test the exported behavior: normal cases, edge cases, and errors.`
      + ` Each test should fail if the code it covers breaks.`,
    `Describe what the code does now. If something looks like a bug, test the current`
      + ` behavior and say so in your final message.`,
    `Don't edit ${task.context.file} or anything outside ${task.context.testFile}.`,
    `Match the style of ${task.context.example}.`,
  ].join("\n\n"),
  tools: ["Read", "Write", "Edit", "Grep", "Glob", `Bash(pnpm vitest run ${task.context.testFile}*)`],
  maxTurns: 30,
})
```

- **Write is allowed** here (unlike fix-ci), because the test file may not exist yet. Gate 1 limits it to that one path.
- **Bash is scoped to its own test file**, so parallel workers don't run each other's suites.

## Gates

Cheap first. The last two decide whether the tests are any good.

| \#  | Gate                                                                      | Passes when                                                                        | Blocks                                                                           | Status            | Cost      |
|-----|---------------------------------------------------------------------------|------------------------------------------------------------------------------------|----------------------------------------------------------------------------------|-------------------|-----------|
| 1   | `onlyTouches((t) => [t.context.testFile])`                                | Only this task's test file changed                                                 | Editing the source to make tests easy; touching other files                      | exists            | Cheap     |
| 2   | `noPattern([...CHEATS, /\.(todo|skip|only)\(/, /expect\(true\)/])`        | No skips or trivially true assertions                                              | Placeholder tests                                                                | exists            | Cheap     |
| 3   | `countNotLess(/\bexpect\(/, (t) => [t.context.testFile])`                 | Existing assertions kept (when extending a file)                                   | Replacing old tests with new ones                                                | from update-tests | Cheap     |
| 4   | `` commandPasses((t) => `pnpm vitest run ${t.context.testFile}`) ``       | The new tests pass                                                                 | Tests that don't run                                                             | exists            | Medium    |
| 5   | `coverageAtLeast((t) => t.context.file, (t) => t.context.coverageTarget)` | Line coverage of the target file reaches the target                                | Tests that skip most of the code                                                 | new               | Medium    |
| 6   | `mutationKills((t) => t.context.file, { mutants: 6, minKillRate: 0.66 })` | When the source is broken on purpose, the tests fail for at least 2 of 3 breakages | Weak tests: `toBeDefined()`, snapshot-everything, tests that never check results | new               | Expensive |

```ts
// new: break the source in small, realistic ways and check the tests notice.
// Runs in a temporary copy of the worktree; the task's worktree is never modified.
const MUTATORS = [
  { name: "flip comparison", find: /(?<![=!<>])(<=|>=|<|>)(?!=)/g, swap: { "<": ">=", ">": "<=", "<=": ">", ">=": "<" } },
  { name: "flip equality",   find: /===|!==/g, swap: { "===": "!==", "!==": "===" } },
  { name: "swap arithmetic", find: /(?<=\s)[+-](?=\s)/g, swap: { "+": "-", "-": "+" } },
  { name: "off by one",      find: /\b(\d+)\b/g, map: (n) => String(Number(n) + 1) },
  { name: "negate condition", find: /if \((.+)\) \{/g, map: (_, c) => `if (!(${c})) {` },
  { name: "drop return",     find: /return ([^;]+);/g, map: () => "return undefined as never;" },
];

export function mutationKills(file: (t: Task) => string, opts: { mutants: number; minKillRate: number }): Gate {
  /* one mutation per mutant, at one site; sites that don't compile (e.g. "<" in a generic) are skipped
     pick up to opts.mutants single-site mutations spread across the file
     → for each: copy worktree, apply one mutation, run that task's test file
     → killed = tests failed (and the file still compiles; otherwise skip that mutant)
     → pass when killed / tried ≥ minKillRate; reasons list the survivors with line numbers */
}
```

**Why mutation testing:** passing tests and high coverage can both be faked with tests that call everything and check nothing. A mutant that survives is a concrete reason for the retry: "changing `<` to `>=` on line 14 didn't fail any test". Stryker does this properly; six hand-written mutators are enough to start and easy to explain.

## When it fails

| Situation                                                            | What happens                                                                                              |
|----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| Surviving mutants                                                    | Retry with the list of survivors and their line numbers. The worker adds tests that pin those spots down. |
| Coverage below target                                                | Retry with the uncovered line ranges from the coverage report.                                            |
| One file fails, others pass                                          | Run status `partial`. The passing files' tests are still usable; the CLI offers to apply only those.      |
| A file is untestable as written (no exports, side effects at import) | Fails after retries. The output says why; refactoring it is a person's call.                              |

## Output

```ts
// finish()
{
  files: {
    file: string; testFile: string; ok: boolean;
    coverage: { before: number; after: number };
    mutants: { tried: number; killed: number };
  }[];
  diffs: (string | undefined)[];
}
```

Per-file numbers are what make this convincing in a README: "coverage 0% → 91%, 5 of 6 mutants killed".

## Flow

```ts
engine                     add-tests                        workers / gates
──────                     ─────────                        ───────────────
start({ auto })     ──▶    plan(): coverage summary → pick files below the bar
                           └─ [task per file, no dependsOn]
scheduler: up to maxWorkers at once
  task A  ─▶ worktree A ─▶ worker writes test/a.test.ts ─▶ gates 1..6 (mutants run here)
  task B  ─▶ worktree B ─▶ worker writes test/b.test.ts ─▶ gates 1..6
  each: pass → done · fail → survivors / uncovered lines appended, retry
finish(results)     ──▶    { files: [coverage, mutants per file], diffs }
```

## Scenarios

The playground needs `@vitest/coverage-v8` and some untested code. Each patch adds source files without tests.

| Scenario      | Setup                                                              | Expected                                                               | Hard checks                                                                           |
|---------------|--------------------------------------------------------------------|------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `t-clean`     | None; everything above the bar                                     | 0 tasks, \$0                                                           | planned 0                                                                             |
| `t-new-file`  | `src/text.ts` (`truncate`, `titleCase`, `pluralize`) with no tests | New `test/text.test.ts`, coverage ≥ 80%, ≥ 4 of 6 mutants killed       | completed, only the test file added, independent re-run of coverage and mutants       |
| `t-extend`    | `Cart` gains `applyCoupon`, untested                               | Tests appended to `cart.test.ts`; existing tests intact                | assertion count not lower, coverage target met                                        |
| `t-weak-trap` | `src/shipping.ts` returning an object of computed fields           | Weak `toBeDefined` tests rejected by the mutation gate, then real ones | completed; ideally a mutation-gate retry seen                                         |
| `t-parallel`  | Three untested files                                               | Three tasks, two at a time; three new test files                       | tasks overlapped in time, distinct files, all three diffs applied together still pass |
| `t-buggy`     | `src/text.ts` where `truncate` has an off-by-one                   | Tests describe current behavior; source untouched                      | `src/` unchanged                                                                      |

## Files

| Path                                      | What                                                   |
|-------------------------------------------|--------------------------------------------------------|
| `packages/recipes/src/add-tests/index.ts` | The recipe                                             |
| `packages/recipes/src/shared/coverage.ts` | `parseCoverageSummary`, `testPathFor`                  |
| `packages/engine/src/gates/coverage.ts`   | `coverageAtLeast`                                      |
| `packages/engine/src/gates/mutation.ts`   | `mutationKills` and the mutators                       |
| `packages/recipes/scripts/scenarios.ts`   | Rows for `t-*`; a check that parallel tasks overlapped |
| `orca-playground/package.json`            | `@vitest/coverage-v8`                                  |
| `orca-playground/scenarios/t-*.patch`     | The untested code                                      |

## Build checklist

- [ ] Playground: coverage provider, and the `t-*` patches
- [ ] `mutationKills` first, tested on its own: a strong hand-written test file kills most mutants, a `toBeDefined` file kills none
- [ ] `coverageAtLeast` and `parseCoverageSummary`
- [ ] Parallel run of two tasks with the fake messenger: no git lock errors, distinct worktrees
- [ ] The recipe
- [ ] All `t-*` scenarios green on real runs
- [ ] A coverage push on one of your real repos, with before/after numbers

## Open questions

- **Reporting suspected bugs.** The worker's final message isn't in `TaskResult` today. Adding `summary` to task results would let `finish()` list suspected bugs, which could start fix-ci.
- **Mutation cost.** Six mutants means six test runs per attempt. Fine for one file; for big files, mutate only the lines the new tests cover.
- **Stryker.** Swap the hand-written mutators for Stryker when accuracy matters more than simplicity.
- **Combined check.** Diffs touch different files, so merging is safe, but a final run of all new tests together belongs in Phase 6's integration step.
- **Flaky new tests.** Run each new test file twice in gate 4, or reuse fix-flaky's `repeatPasses`.

## Chains

| Chain                  | Role                                 | Gets                      | Hands on                                                                |
|------------------------|--------------------------------------|---------------------------|-------------------------------------------------------------------------|
| Coverage push          | The whole chain, then pr-review      | `auto` settings           | Test files and per-file numbers                                         |
| Safety net first (new) | Before migrate-api or a big refactor | The files about to change | Tests that pin current behavior, so the migration has something to pass |
| Spec to feature        | After each ticket's code is built    | The new files             | Tests, before the integration gate                                      |
