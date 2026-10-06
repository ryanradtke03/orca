Recipe spec · read-only · phase 4 · shared PR tail

# `pr-describe`

Write a PR title and description from the diff, the issue and the results of the runs that produced it. Opening the PR is a plain code step; writing it is the part that needs a model, and the part where a model is tempted to claim things that didn't happen.

## Header

- **Status:** next Spec written, not built
- **Category:** Read-only
- **Phase:** 4 · Read-only workers (built right after pr-review: same pattern)
- **Effort:** About a day once pr-review exists
- **Engine uses:** Base refs and task output from [Composition](#composition); `onlyTouches([])`; `outputMatches` from pr-review
- **New engine work:** Gates `mentionsOnlyDiffFiles` and `claimsMatchEvidence`. The shared `ctx.openPr()` tail

## When to use it

### Example requests

- "Write the PR description for my branch."
- "Describe what the bug-42 chain changed, for the reviewer."

### Triggers

- The shared PR tail at the end of every chain
- CLI: `orca run pr-describe --head my-branch` on branches you wrote yourself
- The Ready for review chain

### Non-goals

| Won't do                            | Use instead                  |
|-------------------------------------|------------------------------|
| Open, push or update the PR         | `PrSink.open()`, a code step |
| Judge the change                    | `pr-review`                  |
| Write release notes across many PRs | A future changelog recipe    |

## Input

```ts
input: z.object({
  base: z.string().default("main"),
  head: z.string(),
  issue: z.object({ number: z.number(), text: z.string() }).optional(),
  evidence: z.array(z.object({        // results from the runs that built this branch
    recipe: z.string(),               // "repro-bug", "fix-ci", "pr-review"
    ok: z.boolean(),
    gatesPassed: z.array(z.string()), // ["noFileChanges", "commandPasses: pnpm vitest run test/repro/issue-42.test.ts"]
    summary: z.string().optional(),   // e.g. the review verdict
  })).default([]),
  template: z.string().optional(),    // the repo's PR template, if it has one
})
```

**Evidence is the key input.** Chains pass in what actually ran and passed. Run by hand on your own branch, the evidence list is empty, so the description may not claim any testing at all, and it says so.

## Plan

```ts
async plan(input, ctx) {
  const diff = (await ctx.exec(`git diff ${input.base}...${input.head}`)).output;
  if (!diff.trim()) return [];
  const log = (await ctx.exec(`git log --oneline ${input.base}..${input.head}`)).output;
  return [{
    id: "describe",
    goal: "Write the PR title and description",
    dependsOn: [],
    context: {
      diff: trim(diff, 20000),
      files: changedFiles(diff),          // for gate 3
      commits: log,
      issue: input.issue,
      evidence: input.evidence,           // for gate 5
      template: input.template ?? readPrTemplate(ctx.repo),   // .github/pull_request_template.md
    },
  }];
}
```

## Worker

```ts
worker: (task) => ({
  prompt: [
    `Write a PR title and description for this change.`,
    task.context.issue && `It addresses issue #${task.context.issue.number}:\n"""\n${task.context.issue.text}\n"""`,
    `Diff:\n\`\`\`diff\n${task.context.diff}\n\`\`\``,
    `What actually ran and passed:\n${formatEvidence(task.context.evidence) || "(nothing; say testing was not run)"}`,
    `Only describe testing that appears in that list. Only mention files in the diff.`,
    task.context.template && `Follow this template:\n${task.context.template}`,
    `Final message: only JSON matching:\n${JSON.stringify(z.toJSONSchema(PrDescriptionSchema))}`,
  ].filter(Boolean).join("\n\n"),
  tools: ["Read", "Grep", "Glob"],
  maxTurns: 12,
})
```

```ts
export const PrDescriptionSchema = z.object({
  title: z.string().min(10).max(72),
  summary: z.string().max(800),                       // why, in plain words
  changes: z.array(z.object({ file: z.string(), what: z.string().max(200) })).max(20),
  testing: z.array(z.object({ claim: z.string(), evidence: z.string() })),   // evidence names a gate or run
  risks: z.array(z.string()).max(5),
  closes: z.number().int().optional(),                // issue number
});

// render() turns it into markdown: title, "Fixes #42", summary, changes, testing, risks, a footer with cost and trace
```

## Gates

Read-only, like pr-review, plus two gates that keep the description honest.

| \#  | Gate                                             | Passes when                                                                                    | Blocks                                                                | Status         | Cost  |
|-----|--------------------------------------------------|------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|----------------|-------|
| 1   | `onlyTouches([])`                                | Nothing changed                                                                                | Edits                                                                 | exists         | Cheap |
| 2   | `outputMatches(PrDescriptionSchema)`             | Valid JSON in the schema; title under 72 characters                                            | Free text, novel-length descriptions                                  | from pr-review | Cheap |
| 3   | `mentionsOnlyDiffFiles((t) => t.context.files)`  | Every file in `changes` is in the diff, and every changed source file is mentioned             | Invented files; silently skipped changes                              | new            | Cheap |
| 4   | `closesIssue((t) => t.context.issue?.number)`    | When an issue was given, `closes` is set to it                                                 | Unlinked PRs                                                          | new, tiny      | Cheap |
| 5   | `claimsMatchEvidence((t) => t.context.evidence)` | Every `testing` entry cites evidence that's in the input; with no evidence, `testing` is empty | "Added tests", "verified manually", "all tests pass" when nothing ran | new            | Cheap |

```ts
// new: testing claims must point at real evidence
export function claimsMatchEvidence(evidence: (t: Task) => Evidence[]): Gate {
  return { name: "claimsMatchEvidence", async check(ctx) {
    const known = evidence(ctx.task).flatMap((e) => [e.recipe, ...e.gatesPassed]);
    const out = extractJson(ctx.output);
    const bad = out.testing.filter((c) => !known.some((k) => c.evidence.includes(k)));
    return bad.length === 0 ? { ok: true }
      : { ok: false, reasons: bad.map((c) => `testing claim "${c.claim}" cites "${c.evidence}", which isn't in the run evidence`) };
  } };
}
```

**Why gate 5:** AI-written PR descriptions often say "added tests" or "verified locally" when nothing like that happened. Tying each claim to a gate that actually passed makes the description something a reviewer can trust.

## When it fails

| Situation                          | What happens                                                                                                                        |
|------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| Schema, file or claim gate fails   | Reasons into the retry                                                                                                              |
| No valid description after retries | The tail falls back to a plain template: title from the issue or branch, the file list, and the evidence verbatim. A PR still opens |
| Empty diff                         | Plan returns `[]`; the tail skips opening a PR                                                                                      |

## Output

```ts
// finish()
{ title: string; body: string /* rendered markdown */; parsed: PrDescription }
```

## Flow: the shared PR tail

```ts
ctx.openPr(branch, { base, issue, runs })      // every chain ends here
  1. evidence = runs.map(toEvidence)             // which gates passed, review verdict
  2. describe = ctx.run("pr-describe", { base, head: branch, issue, evidence }, { base: branch })
  3. review   = ctx.run("pr-review",   { base, head: branch, issue },           { base: branch })
  4. body     = describe.ok ? describe.output.body : fallbackBody(...)
               + review section (verdict, blocking comments first)
  5. PrSink.open({ branch, base, title, body, draft: true })
  6. PrSink.comment(issue, "Opened <url>")
```

Steps 2 and 3 don't depend on each other, so the tail can run them in parallel.

## Scenarios

Seeded branches with known evidence. Most checks are exact, since the output is structured.

| Scenario        | Branch + evidence                                            | Expected                                                                  | Hard checks                                     |
|-----------------|--------------------------------------------------------------|---------------------------------------------------------------------------|-------------------------------------------------|
| `d-chain`       | The Bug to PR median fix; evidence from repro-bug and fix-ci | Title, summary, both files, testing cites the repro test command          | All gates; `closes` is 42                       |
| `d-no-evidence` | Your own branch, evidence empty                              | `testing` empty; summary doesn't claim tests                              | `testing.length === 0`                          |
| `d-tempting`    | Branch adds a test file, but evidence shows it was never run | Mentions the new test file under changes, makes no testing claim about it | Gate 5 passes; no claim cites an unknown source |
| `d-template`    | Repo has a PR template with required headings                | Rendered body contains each heading                                       | Headings present                                |
| `d-big`         | 40-file mechanical rename                                    | Changes grouped; under 20 entries; every source file covered              | Gate 3 passes                                   |

## Files

| Path                                                  | What                                                          |
|-------------------------------------------------------|---------------------------------------------------------------|
| `packages/recipes/src/pr-describe/index.ts`           | The recipe, `PrDescriptionSchema`, `render()`                 |
| `packages/engine/src/gates/output.ts`                 | `mentionsOnlyDiffFiles`, `closesIssue`, `claimsMatchEvidence` |
| `packages/engine/src/chain.ts`                        | `ctx.openPr()` (the shared tail) and `fallbackBody`           |
| `orca-playground/scenarios/d-*.patch` + evidence JSON | Seeded branches                                               |

## Build checklist

- [ ] After pr-review: reuse its read-only setup and `outputMatches`
- [ ] The three new gates, unit-tested
- [ ] `render()` and `fallbackBody`, unit-tested without the model
- [ ] The recipe; `d-*` scenarios green
- [ ] `ctx.openPr()`; Bug to PR switched to use it

## Open questions

- **Combine with pr-review?** One worker could write both and save a run. Kept separate so each has a narrow job and its own eval.
- **Updating an existing PR.** After more commits, regenerate the description and edit the PR instead of opening a new one.
- **Screenshots for UI changes.** Out of scope until there's a browser step.

## Chains

| Chain                       | Role                                   | Gets                             | Hands on                           |
|-----------------------------|----------------------------------------|----------------------------------|------------------------------------|
| Every chain that opens a PR | Part of the shared tail `ctx.openPr()` | Branch, issue, run evidence      | Title and body, to `PrSink.open()` |
| Ready for review            | Last step                              | Your branch and the cleanup runs | The PR description                 |
