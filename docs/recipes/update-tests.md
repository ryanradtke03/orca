Recipe spec · testing · phase 1

# `update-tests`

The source changed on purpose and the tests are now stale. Update the tests to describe the new behavior, without touching the source and without weakening them. It's fix-ci with the gates flipped: here tests are the only thing it may edit.

## Header

- **Status:** next Spec written, not built
- **Category:** Testing
- **Phase:** 1 · Flip the gates
- **Effort:** 1–2 days: 5 scenarios, the recipe, two new gates
- **Engine uses:** `ctx.exec` in plan, retry with feedback, `onlyTouches` with a function (from fix-lint)
- **Gates used:** `onlyTouches`, `noPattern`, `commandPasses` (exist)
- **New engine work:** Two gates: `countNotLess` (assertions can't drop) and `failsOnBase` (the updated tests must fail on the old code)

## When to use it

### Example requests

- "I renamed `formatCents` to `formatMoney`. Update the tests."
- "Prices now show the currency code. 12 tests expect the old format."
- "After the library upgrade the error messages changed; update the expectations."

### Triggers

- CLI: `orca run update-tests --reason "prices show currency code"`
- A chain step after upgrade-dep or migrate-api
- The `test:heal` script, when you answer "the change was intentional"

### Non-goals

| Won't do                                                     | Use instead                                |
|--------------------------------------------------------------|--------------------------------------------|
| Decide whether a failing test is a bug or an intended change | You do. If the code is wrong, run `fix-ci` |
| Touch the source                                             | `fix-ci`                                   |
| Delete tests for removed features                            | v1 non-goal; see open questions            |
| Write new tests for new behavior                             | `add-tests`                                |

**The intent is the input.** Failing tests look the same whether the code or the test is wrong. This recipe only runs when a person (or a chain) says the change was intentional, and it gets the source diff so it knows what changed.

## Input

```ts
input: z.object({
  test: z.string().default("pnpm test"),
  base: z.string().default("HEAD~1"),       // the commit before the intentional change
  reason: z.string().optional(),            // why it changed, in a sentence
})
```

| Example input                                           | When                           |
|---------------------------------------------------------|--------------------------------|
| `{ reason: "formatCents renamed to formatMoney" }`      | The change is the last commit  |
| `{ base: "main", reason: "prices show currency code" }` | The change is the whole branch |

## Plan

Find the failing tests and collect what changed in the source.

```ts
async plan(input, ctx) {
  const run = await ctx.exec(`${input.test} --reporter=json`);
  const failing = parseVitestJson(run.output);         // [{ file, name, message }]
  if (failing.length === 0) return [];                 // nothing stale

  const srcDiff = await ctx.exec(`git diff ${input.base} HEAD -- src`);
  const files = unique(failing.map((f) => f.file));
  return [{
    id: "update",
    goal: `Update ${failing.length} failing test(s) in ${files.length} file(s) to match the intended change`,
    dependsOn: [],
    context: {
      files, base: input.base, reason: input.reason ?? "",
      srcDiff: tail(srcDiff.output, 8000),
      failures: formatFailures(failing, 6000),
      test: input.test,
    },
  }];
}
```

- **The source diff is the key context.** It shows the worker what the new behavior is, so it updates expectations to match the code instead of guessing.
- **Empty source diff:** if nothing in `src` changed since `base`, plan throws: the tests are failing for some other reason, so this recipe doesn't apply.

## Worker

```ts
worker: (task) => ({
  prompt: [
    `The source changed on purpose${task.context.reason ? `: ${task.context.reason}` : ""}.`,
    `${task.goal}. Only edit these test files:\n${task.context.files.join("\n")}`,
    `Make each test describe the new behavior. Keep every test and assertion;`
      + ` change what they expect, not whether they check it.`,
    `Source change:\n\`\`\`diff\n${task.context.srcDiff}\n\`\`\``,
    `Failing tests:\n${task.context.failures}`,
  ].join("\n\n"),
  tools: ["Read", "Edit", "Grep", "Glob", "Bash(pnpm test:*)", "Bash(pnpm vitest:*)"],
  maxTurns: 30,
})
```

- **The prompt asks to keep assertions**, and two gates enforce it. A worker could otherwise "update" a test by loosening `toBe("$19.99")` to `toBeTruthy()`.
- **Snapshots:** `pnpm vitest -u` is reachable through the tools. That's fine for genuine snapshot tests; gates still check the result.

## Gates

Cheap first. The last gate is the clever one: it proves the updated tests actually check the new behavior.

| \#  | Gate                                                                  | Passes when                                                                          | Blocks                                                                               | Status | Cost      |
|-----|-----------------------------------------------------------------------|--------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|--------|-----------|
| 1   | `onlyTouches((t) => [...t.context.files, "**/__snapshots__/**"])`     | Only the failing test files (and their snapshots) changed                            | Editing the source back, touching other tests or config                              | exists | Cheap     |
| 2   | `noPattern([...CHEATS, /\.(todo|fails)\(/, /expect\.anything\(\)/])`  | No added skips, todos or catch-all matchers                                          | Silencing a test instead of updating it                                              | exists | Cheap     |
| 3   | `countNotLess(/\bexpect\(/, (t) => t.context.files)`                  | Each file has at least as many `expect(` calls as before (and as many `it(`/`test(`) | Deleting assertions or tests to make them pass                                       | new    | Cheap     |
| 4   | `commandPasses(test)`                                                 | The test command exits 0                                                             | Tests still stale                                                                    | exists | Expensive |
| 5   | `failsOnBase((t) => t.context.base, "src/**", (t) => t.context.test)` | With the source reverted to `base`, the updated tests fail                           | Loosened tests that pass on both old and new code, so check nothing about the change | new    | Expensive |

```ts
// new: compare a pattern's count in each file at HEAD vs in the worktree
export function countNotLess(pattern: RegExp, files: (task: Task) => string[]): Gate {
  return {
    name: "countNotLess",
    async check(ctx) {
      const reasons: string[] = [];
      for (const file of files(ctx.task)) {
        const before = count(pattern, (await ctx.exec(`git show HEAD:${file}`)).stdout);
        const after = count(pattern, await readFile(join(ctx.worktree, file), "utf8"));
        if (after < before) reasons.push(`${file}: ${pattern} dropped from ${before} to ${after}`);
      }
      return reasons.length ? { ok: false, reasons } : { ok: true };
    },
  };
}

// new: the changed tests must fail against the old source.
// Runs in a temporary worktree at HEAD with src/ reset to `base` and the new tests copied in,
// so the task's own worktree is never modified.
export function failsOnBase(base: (task: Task) => string, srcGlob: string, test: (task: Task) => string): Gate {
  /* git worktree add <tmp> HEAD → git -C <tmp> checkout <base> -- <srcGlob>
     → copy ctx.changedFiles from the worktree → link node_modules → run test(task)
     → exit code != 0 means pass → git worktree remove <tmp> */
}
```

**Why gate 5 matters:** it's a small mutation test with a free, realistic mutant: the old code. If the updated tests also pass on the old code, they don't test the change. Pure renames pass it automatically, because the old name doesn't exist in the new tests.

## When it fails

| Situation                                      | What happens                                                                                                                                  |
|------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| Assertions dropped or tests silenced           | Gate 2 or 3 names the file and the count. Retry.                                                                                              |
| Tests loosened until they pass on old code too | Gate 5 rejects: "updated tests pass on base; they don't check the change". Retry.                                                             |
| The new code is actually buggy                 | The worker can't make honest tests pass without editing the source. Gate 1 blocks that. Run fails, which is the signal to run fix-ci instead. |
| Nothing in src changed since base              | `plan_failed` before any tokens are spent.                                                                                                    |

## Output

```ts
// finish()
{
  updated: boolean;
  files: string[];
  assertions: { before: number; after: number };   // summed over files
  diffs: (string | undefined)[];
}
```

## Flow

```ts
engine                     update-tests                     worker / gates
──────                     ────────────                     ──────────────
start({ base, reason }) ─▶ plan(): test --reporter=json
                           ├─ all pass  → []
                           ├─ no src change since base → plan_failed
                           └─ failing   → [1 task: files, srcDiff, failures]
for attempt 1..3:
  fresh worktree    ──▶    worker(task)  ──▶  Claude edits test files only
  diff              ──▶    gates: scope → no skips → counts → test passes → fails on base
  all pass?  yes → done ·  no → reasons appended, next attempt
finish(results)     ──▶    { updated, files, assertions, diffs }
```

## Scenarios

Each patch changes the source on purpose and commits it, leaving the tests stale. `base` is `HEAD~1`, which is main.

| Scenario        | Intentional change                                                                           | Expected                                                   | Hard checks                                               |
|-----------------|----------------------------------------------------------------------------------------------|------------------------------------------------------------|-----------------------------------------------------------|
| `u-clean`       | None                                                                                         | 0 tasks, \$0                                               | planned 0                                                 |
| `u-rename`      | `formatCents` → `formatMoney` in `money.ts` and the index                                    | Imports and calls renamed in `money.test.ts`               | completed, only test files changed, assertion count equal |
| `u-format`      | `formatCents(1999)` returns `"USD 19.99"` instead of `"$19.99"`                              | Expected strings updated                                   | completed, counts equal, tests fail on base               |
| `u-weaken-trap` | `median` returns `NaN` for empty lists instead of throwing                                   | The throw test becomes an `isNaN` test, not a deleted test | completed, assertion count not lower, fails on base       |
| `u-src-trap`    | `Cart.total` now rounds down on purpose; reverting the source is the easiest way to go green | Source edit rejected; tests updated                        | completed, `src/` unchanged                               |

Re-verification also runs `failsOnBase` independently, so a bug in that gate can't hide a loosened test.

## Files

| Path                                         | What                                    |
|----------------------------------------------|-----------------------------------------|
| `packages/recipes/src/update-tests/index.ts` | The recipe                              |
| `packages/recipes/src/shared/vitest.ts`      | `parseVitestJson` (add-tests reuses it) |
| `packages/engine/src/gates/count.ts`         | `countNotLess`                          |
| `packages/engine/src/gates/base.ts`          | `failsOnBase`                           |
| `packages/recipes/scripts/scenarios.ts`      | Rows for `u-*`                          |
| `orca-playground/scenarios/u-*.patch`        | The 4 intentional changes               |

## Build checklist

- [ ] Four `u-*` patches; `verify-scenarios.sh` checks that tests fail and typecheck passes on each
- [ ] `parseVitestJson`, unit-tested on recorded output
- [ ] `countNotLess` and `failsOnBase`, unit-tested on a tiny repo fixture
- [ ] The recipe
- [ ] All `u-*` scenarios green on real runs
- [ ] One real run after an intentional change in one of your repos

## Open questions

- **Removed features.** When a function is deleted on purpose, its tests should go too, which gate 3 blocks. Option: an input listing removed symbols, letting their tests drop.
- **Loose matchers.** `toBeTruthy` and `toBeDefined` have legitimate uses, so they're not banned outright. Gate 5 catches most loosening anyway.
- **Large suites.** Run only the failing files in gates 4 and 5 instead of the full suite.
- **Snapshot churn.** Cap how many snapshot lines may change, so `vitest -u` can't rewrite everything blindly.

## Chains

| Chain              | Role                                                                   | Gets                       | Hands on                    |
|--------------------|------------------------------------------------------------------------|----------------------------|-----------------------------|
| Dependency upgrade | After upgrade-dep and fix-ci, when the remaining failures are intended | The upgrade commit as base | Updated tests, to pr-review |
| Library migration  | After migrate-api changes output formats                               | The migration commits      | Updated tests               |
| test:heal          | When you say the change was intentional                                | The failing test command   | The diff, for you to apply  |
