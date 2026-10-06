Recipe spec · testing · phase 2 · step 1 of Bug to PR

# `repro-bug`

Turn a bug report into one test that fails on the current code, for the reason the report describes. The reverse of every other recipe: success means the test command *fails*.

## Header

- **Status:** built Verified on 5 scenarios with real Claude runs
- **Category:** Testing
- **Phase:** 2 · Tests that test (first used in Phase 5's Bug to PR)
- **Effort:** 1–2 days: the recipe, two new gates, 5 scenarios
- **Engine uses:** `onlyTouches` with a function, task output (for "cannot reproduce" reasons)
- **Gates used:** `onlyTouches`, `noPattern` (exist)
- **New engine work:** Gates `commandFails` and `failsWithAssertion`. Task output from [Composition](#composition-output)

## When to use it

### Example reports

- "`median([1,2,3,4])` returns 3. Should be 2.5."
- "Cart totals with a 10% discount are sometimes a cent low."
- "`slugify("a -- b")` gives `a----b`."

### Triggers

- Step 1 of [Bug to PR](#bug-to-pr)
- CLI: `orca run repro-bug --report "…"` to get just the test
- Before fixing a bug by hand: the test proves the fix later

### Non-goals

| Won't do                                                | Use instead                       |
|---------------------------------------------------------|-----------------------------------|
| Fix the bug                                             | `fix-ci`, next in the chain       |
| Decide whether the report is a bug or a feature request | A person, or a future triage step |
| Flaky or timing bugs that don't fail every run          | `fix-flaky`                       |
| UI or end-to-end bugs                                   | Unit-level only in v1             |

## Input

```ts
input: z.object({
  report: z.string().min(10),                     // title + body, trimmed to 4,000 chars
  issue: z.number().int().optional(),             // used in the file name
  test: z.string().default("pnpm vitest run"),
  dir: z.string().default("test/repro"),
})
```

| Example input                                           | When                                        |
|---------------------------------------------------------|---------------------------------------------|
| `{ report: "median([1,2,3,4]) returns 3…", issue: 42 }` | From Bug to PR                              |
| `{ report: "…" }`                                       | By hand; the file is named after the run id |

**Untrusted text:** the report only ever goes into the prompt. Commands and file paths are built by the recipe, never taken from the report.

## Plan

Always one task. Nothing to measure first: the point is to find out whether the bug exists.

```ts
async plan(input, ctx) {
  const name = input.issue ? `issue-${input.issue}` : ctx.runId.slice(-8);
  const reproFile = `${input.dir}/${name}.test.ts`;
  return [{
    id: "repro",
    goal: "Write one test file that fails because of the reported bug",
    dependsOn: [],
    context: {
      report: trim(input.report, 4000),
      reproFile,
      command: `${input.test} ${reproFile}`,      // what fix-ci will be handed
      example: pickExampleTest(),                 // style to copy
    },
  }];
}
```

## Worker

```ts
worker: (task) => ({
  prompt: [
    `A user reported a bug:\n"""\n${task.context.report}\n"""`,
    `Find the code involved and write a test in ${task.context.reproFile} that`
      + ` checks the CORRECT behavior described in the report. It must fail on the`
      + ` current code because of this bug, and pass once the bug is fixed.`,
    `Keep it small: the fewest tests that show the bug. Import from the real source.`,
    `Don't edit any other file. If the code already behaves correctly, or the report`
      + ` is too vague to test, stop and start your final message with`
      + ` CANNOT_REPRODUCE: and the reason.`,
    `Match the style of ${task.context.example}.`,
  ].join("\n\n"),
  tools: ["Read", "Grep", "Glob", "Write", "Edit", `Bash(${task.context.command}*)`],
  maxTurns: 25,
})
```

- **Write is allowed** for the one new file; gate 1 enforces it.
- **CANNOT_REPRODUCE** is a clean exit. `onFailed` reads it from the task output so the chain can quote it in the issue comment.

## Gates

The interesting part: a failing test is easy to fake. It has to fail for the right reason.

| \#  | Gate                                                                                   | Passes when                                                                                                    | Blocks                                                                      | Status | Cost   |
|-----|----------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|--------|--------|
| 1   | `onlyTouches((t) => [t.context.reproFile])`                                            | Only the repro file was created or changed                                                                     | Fixing the bug while it's there; editing other tests                        | exists | Cheap  |
| 2   | `noPattern([...CHEATS, /\.(skip|todo|fails)\(/, /expect\(true\)/, /throw new Error/])` | No skipped, todo or hand-thrown failures                                                                       | Tests that fail on purpose without checking anything                        | exists | Cheap  |
| 3   | `commandPasses("pnpm typecheck")`                                                      | The test file type-checks                                                                                      | A test that "fails" because it imports something that doesn't exist         | exists | Medium |
| 4   | `commandFails((t) => t.context.command)`                                               | The test command exits non-zero                                                                                | Tests that pass, so the bug isn't shown                                     | new    | Medium |
| 5   | `failsWithAssertion((t) => t.context.command)`                                         | Every failing test failed on an assertion (`AssertionError` in Vitest's JSON), and it fails the same way twice | Crashes, timeouts, syntax errors and flaky failures counted as "reproduced" | new    | Medium |

```ts
// new: the inverse of commandPasses
export function commandFails(command: string | ((t: Task) => string)): Gate {
  return { name: "commandFails", async check(ctx) {
    const cmd = typeof command === "function" ? command(ctx.task) : command;
    const { code } = await ctx.exec(cmd);
    return code !== 0 ? { ok: true } : { ok: false, reasons: [`\`${cmd}\` passed; the test doesn't show the bug`] };
  } };
}

// new: run twice with --reporter=json; every failed test must have an assertion error
export function failsWithAssertion(command: string | ((t: Task) => string)): Gate {
  /* for run of [1, 2]: exec(`${cmd} --reporter=json`) → parse
     → reject if any failure's error isn't an assertion (TypeError, ReferenceError, timeout…)
     → reject if the set of failing tests differs between the two runs (flaky) */
}
```

**Why gate 5 matters:** without it, `expect(median(undefined))` crashing with a TypeError counts as a reproduction, and fix-ci then "fixes" a crash nobody reported.

## When it fails

| Situation                                                 | What happens                                                                                                      |
|-----------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| Test passes (code is correct, or the test misses the bug) | Gate 4 reason in the retry: look again at what the report says                                                    |
| Test crashes instead of asserting                         | Gate 5 names the error type; retry                                                                                |
| Worker says CANNOT_REPRODUCE                              | Treated as a failed attempt with that reason; after `maxAttempts` the run fails and the reason goes in the output |
| Flaky                                                     | Gate 5 rejects; repeated flakiness ends the run. A hint to try fix-flaky                                          |

## Output

```ts
// finish()
{
  reproduced: boolean;
  reproFile?: string;              // "test/repro/issue-42.test.ts"
  command?: string;                // handed to fix-ci
  failure?: string;                // the assertion message, e.g. "expected 3 to be 2.5"
  reason?: string;                 // when not reproduced: CANNOT_REPRODUCE text or last gate reasons
}
```

## Flow

```ts
engine                     repro-bug                        worker / gates
──────                     ─────────                        ──────────────
start({ report, issue }) ─▶ plan(): one task, file name, command
for attempt 1..3:
  fresh worktree    ──▶    worker(task)  ──▶  Claude reads code, writes test/repro/issue-42.test.ts
  diff              ──▶    gates: scope → no fake failures → typecheck → command FAILS → fails on an assertion, twice
  all pass?  yes → done ·  no → reasons appended (or CANNOT_REPRODUCE), next attempt
finish(results)     ──▶    { reproduced, reproFile, command, failure }
```

## Scenarios

Each patch puts a bug on main (committed) and comes with a report text. All in the playground. Real results from Claude runs on Oct 6, 2026.

| Scenario       | Bug + report                                           | Expected                                           | Hard checks                                                                                  | Real result                    |
|----------------|--------------------------------------------------------|----------------------------------------------------|----------------------------------------------------------------------------------------------|--------------------------------|
| `r-clear`      | Median bug; exact numbers in the report                | Test fails with `expected 3 to be 2.5`             | completed; only the repro file; fails on an assertion; passes once the bug patch is reverted | ✓ 1 try, \$0.24, 28s           |
| `r-vague`      | Cart rounding; "sometimes a cent low with discounts"   | Worker finds a failing input                       | Same                                                                                         | ✓ 1 try, \$0.40, 71s           |
| `r-not-a-bug`  | No bug; report calls correct behavior wrong            | Failed with a CANNOT_REPRODUCE reason              | Status failed; reason not empty                                                              | ✓ failed as intended, 3 tries, \$0.49, 44s |
| `r-crash-trap` | Slug bug, where calling with `undefined` crashes first | Crash rejected by gate 5; real assertion test next | Assertion failure only                                                                       | ✓ 1 try, \$0.28, 38s           |
| `r-fix-trap`   | Median bug that's a one-character fix                  | Source edit rejected by gate 1                     | `src/` unchanged                                                                             | ✓ 1 try, \$0.27, 34s           |

The key independent check: revert the bug patch in a fresh worktree, run the repro test, and it must pass. That proves the test checks this bug and nothing else.

Across the five: 5/5 hard checks green, ~1.4 attempts on average, ~\$1.68 total (~\$0.34 each).

## Files

| Path                                                    | What                                                            |
|---------------------------------------------------------|-----------------------------------------------------------------|
| `packages/recipes/src/repro-bug/index.ts`               | The recipe                                                      |
| `packages/engine/src/gates/command.ts`                  | `commandFails`                                                  |
| `packages/engine/src/gates/assertion.ts`                | `failsWithAssertion` (uses `parseVitestJson` from update-tests) |
| `orca-playground/scenarios/r-*.patch` + `r-*.report.md` | Bugs and their reports                                          |

## Build checklist

- [ ] Task output in the engine (needed for CANNOT_REPRODUCE)
- [ ] `commandFails` and `failsWithAssertion`, unit-tested
- [ ] Scenario patches plus report files; `scenarios.ts` passes `report` as input
- [ ] The recipe; all `r-*` green, including the revert check

## Open questions

- **Where the test lives.** A separate `test/repro/` file is easy to scope. Merging it into the related test file afterwards would make a nicer PR.
- **Several bugs in one report.** v1 allows several tests in one file; gate 5 requires all of them to fail on assertions.
- **Non-Vitest repos.** `failsWithAssertion` reads Vitest's JSON. Jest's is similar; one more parser.

## Chains

| Chain                   | Role                          | Gets             | Hands on                               |
|-------------------------|-------------------------------|------------------|----------------------------------------|
| [Bug to PR](#bug-to-pr) | Step 1                        | Issue text       | `command` and the test diff, to fix-ci |
| By hand                 | Before you fix a bug yourself | Your description | A failing test to work against         |
