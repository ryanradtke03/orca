Recipe spec · read-only · phase 4 · step 3 of Bug to PR

# `pr-review`

Review a branch's changes and return a structured verdict with comments pinned to real lines. The first read-only recipe: the worker may not change anything, and the gates check its output instead of a diff.

## Header

- **Status:** built · Verified on 5 scenarios with real Claude runs (Oct 6, 2026)
- **Category:** Read-only
- **Phase:** 4 · Read-only workers
- **Effort:** ~1 day: schema, two new gates, task output in the engine, seeded-diff scenarios
- **Engine uses:** worker task output (`GateContext.output`); `onlyTouches([])` to enforce read-only
- **Gates used:** `onlyTouches` (exists)
- **New engine work:** worker task output (`GateContext.output`, `TaskResult.output`); gates `outputMatches` and `anchoredInDiff`. Base refs (worktree pinned at `head`) deferred to [Composition](#composition): `plan` diffs the refs with `ctx.exec`, and `onlyTouches([])` keeps the run read-only whatever the worktree sits at.

## When to use it

### Example requests

- "Review `orca/bug-42` against main."
- "First pass on this branch before I look."
- "Does this fix address the issue, or just the test?"

### Triggers

- Step 3 of [Bug to PR](#bug-to-pr)
- CLI: `orca run pr-review --head my-branch`
- The last step of most chains, before the PR

### Non-goals

| Won't do                  | Use instead                           |
|---------------------------|---------------------------------------|
| Change code               | A fix recipe; pr-review only comments |
| Style and formatting nits | `fix-lint` and the formatter          |
| Approve for merge         | A person. The verdict is advice       |
| Run the full test suite   | The fix recipes' gates already did    |

## Input

```ts
input: z.object({
  base: z.string().default("main"),
  head: z.string(),                       // the branch to review; the run's base ref
  issue: z.string().optional(),           // what the change is supposed to do
  focus: z.array(z.string()).default([    // what to look for
    "fixes the root cause, not just the test",
    "behavior changes outside the issue",
    "missing edge cases",
  ]),
})
```

## Plan

Collect the diff once; review it in one task.

```ts
async plan(input, ctx) {
  const diff = (await ctx.exec(`git diff ${input.base}...${input.head}`)).output;
  if (!diff.trim()) return [];                                  // nothing to review
  return [{
    id: "review",
    goal: `Review the changes on ${input.head} against ${input.base}`,
    dependsOn: [],
    context: {
      diff: trim(diff, 20000),
      hunks: parseHunks(diff),            // file → changed line ranges, for gate 3
      issue: input.issue ?? "",
      focus: input.focus,
    },
  }];
}
```

## Worker

Read and search only. The final message is the review, as JSON.

```ts
worker: (task) => ({
  prompt: [
    task.context.issue && `The change is meant to address:\n"""\n${task.context.issue}\n"""`,
    `Review this diff. You can read any file for context.\n\`\`\`diff\n${task.context.diff}\n\`\`\``,
    `Look for: ${task.context.focus.join("; ")}.`,
    `Comment only on lines the diff adds or changes. Mark a comment "blocking" only`
      + ` if the change is wrong or incomplete; otherwise "suggestion".`,
    `Your final message must be only JSON matching:\n${JSON.stringify(z.toJSONSchema(ReviewSchema))}`,
  ].filter(Boolean).join("\n\n"),
  tools: ["Read", "Grep", "Glob"],          // no Edit, Write or Bash
  maxTurns: 20,
})
```

```ts
export const ReviewSchema = z.object({
  verdict: z.enum(["approve", "request_changes"]),
  summary: z.string().max(1000),
  comments: z.array(z.object({
    file: z.string(),
    line: z.number().int(),
    severity: z.enum(["blocking", "suggestion"]),
    body: z.string().max(800),
  })).max(15),
}).refine((r) => (r.verdict === "request_changes") === r.comments.some((c) => c.severity === "blocking"),
  "request_changes if and only if there is a blocking comment");
```

## Gates

No diff to check, so the gates check the output.

| \#  | Gate                                     | Passes when                                                                         | Blocks                                                                 | Status | Cost  |
|-----|------------------------------------------|-------------------------------------------------------------------------------------|------------------------------------------------------------------------|--------|-------|
| 1   | `onlyTouches([])`                        | Nothing in the worktree changed                                                     | A reviewer that edits code                                             | exists | Cheap |
| 2   | `outputMatches(ReviewSchema)`            | The final message parses as JSON and matches the schema, including the verdict rule | Free-text reviews, invented fields, approve-with-blockers              | new    | Cheap |
| 3   | `anchoredInDiff((t) => t.context.hunks)` | Every comment's file and line is inside a changed hunk                              | Comments about code the change didn't touch, and invented line numbers | new    | Cheap |

```ts
// new: parse the worker's final message against a Zod schema
export function outputMatches(schema: z.ZodType): Gate {
  return { name: "outputMatches", async check(ctx) {
    const parsed = schema.safeParse(extractJson(ctx.output));
    return parsed.success ? { ok: true }
      : { ok: false, reasons: describeIssues(parsed.error) };   // reused from askJson
  } };
}

// new: comments must point at lines the diff changed
export function anchoredInDiff(hunks: (t: Task) => Record<string, [number, number][]>): Gate {
  /* for each comment in extractJson(ctx.output).comments:
       reject unless hunks[file] has a range containing line (±2 lines of slack) */
}
```

**The quality gate is the scenarios, not a gate.** Code can check that a review is well-formed and grounded. Whether it's *right* is measured by seeding known problems into diffs and counting how many the reviewer catches.

## When it fails

| Situation                     | What happens                                                     |
|-------------------------------|------------------------------------------------------------------|
| Invalid JSON or schema errors | The Zod issues go into the retry, the same way `askJson` retries |
| Comment on an unchanged line  | Gate 3 names the comment; retry                                  |
| No valid review after retries | Run fails. Bug to PR opens the PR marked "not reviewed"          |
| Empty diff                    | Plan returns `[]`; output says nothing to review                 |

## Output

```ts
// finish(): the parsed review
{ verdict: "approve" | "request_changes"; summary: string;
  comments: { file: string; line: number; severity: "blocking" | "suggestion"; body: string }[] }
```

## Flow

```ts
engine                     pr-review                        worker / gates
──────                     ─────────                        ──────────────
start({ head }, { base: head }) ─▶ plan(): git diff base...head → hunks
for attempt 1..3:
  worktree at head  ──▶    worker(task)  ──▶  Claude reads; final message = JSON review
  output            ──▶    gates: no edits → schema → comments anchored in the diff
  all pass?  yes → done ·  no → schema issues / unanchored comments appended, retry
finish(results)     ──▶    the parsed review
```

## Scenarios

Each scenario is a branch with a seeded change and a known right answer. This is how reviewer accuracy gets measured. The harness commits each patch as one commit on top of main and reviews it with `base: HEAD~1, head: HEAD`; the checks read the verdict and comments from `RunResult.output`. Real results from Claude runs on Oct 6, 2026.

| Scenario        | Diff on the branch                                                                         | Expected        | Hard checks                                           | Real result           |
|-----------------|--------------------------------------------------------------------------------------------|-----------------|-------------------------------------------------------|-----------------------|
| `p-good`        | A correct, behavior-preserving `median` refactor                                           | approve         | verdict approve; no blocking comments                 | ✓ 1 try, \$0.245, 12s |
| `p-overfit`     | "Fix" that special-cases the test input: `if (sorted.length === 4) return 2.5`             | request_changes | A blocking comment within 2 lines of the special case | ✓ 1 try, \$0.204, 32s |
| `p-side-effect` | `[...xs].sort()` → `xs.sort()`, so `median` now mutates its argument                       | request_changes | Blocking comment on the `sort` line                   | ✓ 1 try, \$0.181, 22s |
| `p-wrong-fix`   | Issue says `Cart.total` is a cent low; diff changes `formatCents` instead                  | request_changes | Blocking comment saying it doesn't address the issue  | ✓ 1 try, \$0.254, 42s |
| `p-noise`       | A pure local rename (`mid` → `middle`)                                                     | approve         | No blocking comments (false-positive check)           | ✓ 1 try, \$0.113, 5s  |

Track over runs: **catch rate** (seeded problems flagged as blocking) and **false alarms** (blocking comments on p-good and p-noise). Those two numbers are the reviewer's eval.

Across the five (one run each): **catch rate 3/3**, **false alarms 0/2**, all hard and soft checks green, 1.0 attempts each, ~\$1.00 total (~\$0.20 each). The spec asks for three runs per scenario before trusting the number — this is the first run; re-run to confirm stability.

## Files

| Path                                      | What                              |
|-------------------------------------------|-----------------------------------|
| `packages/recipes/src/pr-review/index.ts` | The recipe and `ReviewSchema`     |
| `packages/recipes/src/shared/diff.ts`     | `parseHunks`                      |
| `packages/engine/src/gates/output.ts`     | `outputMatches`, `anchoredInDiff` |
| `orca-playground/scenarios/p-*.patch`     | Seeded branches                   |

## Build checklist

- [x] Task output in the engine (`GateContext.output`, `TaskResult.output`). Base refs (worktree at `head`) deferred to Composition
- [x] `parseHunks`, `outputMatches`, `anchoredInDiff`, unit-tested
- [x] Five `p-*` branches; `scenarios.ts` reads the review from `RunResult.output` (a read-only task has no diff, so the diff/verify loop skips cleanly)
- [x] The recipe; one run each recorded (catch rate 3/3, 0 false alarms). Re-run for the 3-run average

## Open questions

- **Running code.** No Bash in v1, so it can't run a test to check a hunch. A read-only Bash allowlist (`git log`, the test command) may raise the catch rate.
- **Inline GitHub comments.** v1 puts the review in the PR body. Posting inline comments needs the PR sink to call the review API.
- **Second opinion.** Two reviews with different models, keep only comments both agree on, to cut false alarms.

## Chains

| Chain                                                | Role                    | Gets                          | Hands on                               |
|------------------------------------------------------|-------------------------|-------------------------------|----------------------------------------|
| [Bug to PR](#bug-to-pr)                              | Step 3                  | The branch and the issue text | Verdict and comments, into the PR body |
| Dependency upgrade, Coverage push, Library migration | Last step before the PR | The branch                    | The same                               |
