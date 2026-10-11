// Bug to PR: a bug report in, a draft PR out — with a test that proves the bug,
// a fix that makes it pass, and a review. Three child runs, two git commits and a
// PR step, sequenced as one chain under one budget (Recipe Catalog, phase 5).
//
//   repro-bug  → commit the failing test → fix-ci → commit the fix → pr-review
//              → [request_changes: fix-ci with the review → commit → re-review]
//              → pr-describe → open a draft PR → comment the issue
//
// Every gate stays in its recipe; this file only wires them together and decides
// which exit each failure takes.
import { type ChainCtx, defineChain, type Evidence, type RunResult } from "@orchestra/engine";
import { z } from "zod";
import type { PrDescribeResult } from "../pr-describe/index.js";
import type { Review } from "../pr-review/index.js";

const Input = z
  .object({
    issue: z.number().int().optional(), // a GitHub/local issue number to read and link
    report: z.string().min(10).optional(), // or the report text directly
    test: z.string().default("pnpm vitest run"), // the test command repro-bug scopes to its file
    base: z.string().default("main"), // the branch PRs open against; the chain never touches it
  })
  .refine((i) => i.issue !== undefined || i.report !== undefined, {
    message: "give an issue number or a report",
  });

type BugToPrInput = z.infer<typeof Input>;

export type BugToPrStatus =
  | "pr_opened"
  | "repro_only"
  | "cannot_reproduce"
  | "rejected"
  | "partial"
  | "cancelled";

export interface BugToPrStep {
  name: string;
  ok: boolean;
  costUsd: number;
}

export type Verdict = Review["verdict"] | "not_reviewed";

export interface BugToPrOutput {
  status: BugToPrStatus;
  prUrl?: string;
  branch?: string;
  verdict?: Verdict;
  steps: BugToPrStep[];
  costUsd: number;
}

// The gate names each recipe passes, so pr-describe can cite them as evidence and
// claimsMatchEvidence lets the testing claims through.
const REPRO_GATES = [
  "onlyTouches",
  "noPattern",
  "commandPasses",
  "commandFails",
  "failsWithAssertion",
];
const FIXCI_GATES = ["noFileChanges", "noPattern", "commandPasses"];

export const bugToPr = defineChain<BugToPrInput, BugToPrOutput>({
  name: "bug-to-pr",
  description: "Turn a bug report into a draft PR: a failing test, a fix, and a review",
  input: Input,

  async run(input: BugToPrInput, ctx: ChainCtx): Promise<BugToPrOutput> {
    const report =
      input.report ?? (await ctx.step("read-issue", () => ctx.pr.readIssue(input.issue as number)));
    const label = input.issue !== undefined ? `#${input.issue}` : "the report";
    const branchName = `orca/bug-${input.issue ?? ctx.runId}`;
    const steps: BugToPrStep[] = [];
    const record = (name: string, r: RunResult) => {
      steps.push({ name, ok: r.ok, costUsd: r.costUsd });
      return r;
    };

    // 1. a test that fails for the reason the report describes, at the base.
    const repro = record(
      "repro-bug",
      await ctx.run("repro-bug", reproInput(input, report), { base: input.base }),
    );
    if (repro.status === "cancelled") return done("cancelled", { steps, costUsd: repro.costUsd });
    const stop = stoppedEarly(repro);
    if (stop) {
      // Hitting a limit says nothing about the bug, so don't call it unreproducible.
      await comment(
        ctx,
        input,
        `Orca ran out of ${stop} before finishing a repro of ${label}. No conclusion about the bug; rerun with a higher limit.`,
      );
      return done("partial", { steps, costUsd: repro.costUsd });
    }
    if (!repro.ok) {
      // "Not a bug" (the worker's verdict) and "wrote a test that didn't hold up"
      // (only gate reasons) are both no-repro exits, but they read very differently.
      const said = workerSaidCannotReproduce(repro)
        ? `Orca couldn't reproduce ${label} as a failing test.`
        : `Orca wrote a test for ${label}, but it didn't pass Orca's checks, so there's no confirmed repro yet.`;
      await comment(ctx, input, `${said}\n\n${reasonOf(repro)}`);
      return done("cannot_reproduce", { steps, costUsd: repro.costUsd });
    }

    // 2. commit the failing test onto a fresh result branch (your checkout never
    // moves). A rerun on the same issue gets orca/bug-42-2: the old branch may back
    // an open PR, and stacking on it would mix in the old run's commits.
    const branch = await ctx.git.unusedBranch(branchName);
    const reproDiff = diffOf(repro);
    await ctx.step("commit-test", () =>
      ctx.git.commit(branch, {
        from: input.base,
        diff: reproDiff,
        message: `test: reproduce ${label}`,
      }),
    );

    // 3. make the repro test pass, working at the branch so the test actually exists.
    const command = commandOf(repro) ?? input.test;
    const fix = record(
      "fix-ci",
      await ctx.run("fix-ci", { command, issue: report }, { base: branch }),
    );

    const evidence = buildEvidence(repro, fix, command);

    if (!fix.ok) {
      // The test still proves the bug, so open a draft PR with only that commit.
      const pr = await openPr(ctx, {
        branch,
        base: input.base,
        issue: input.issue,
        report,
        evidence: evidence.slice(0, 1),
        reproOnly: true,
      });
      steps.push(...pr.steps);
      await comment(
        ctx,
        input,
        `Orca reproduced ${label} but couldn't fix it automatically. Opened a draft PR with the failing test:\n${pr.url}`,
      );
      return done("repro_only", {
        prUrl: pr.url,
        branch,
        verdict: pr.verdict,
        steps,
        costUsd: sum(steps),
      });
    }

    // 4. commit the fix on top of the test.
    await ctx.step("commit-fix", () =>
      ctx.git.commit(branch, { diff: diffOf(fix), message: `fix: ${label}` }),
    );

    // 5. review against the whole issue; on request_changes, one more fix-ci round
    // with the findings. The tests only cover what repro-bug reproduced, so this is
    // where a fix that leaves part of the issue open gets caught.
    let review = record("pr-review", await runReview(ctx, input.base, branch, report));
    const findings = review.ok ? feedbackOf(review.output as Review) : [];
    if (findings.length > 0) {
      const again = record(
        "fix-ci",
        await ctx.run("fix-ci", { command, issue: report, feedback: findings }, { base: branch }),
      );
      const againDiff = again.ok ? again.tasks[0]?.diff : undefined;
      if (againDiff) {
        await ctx.step("commit-review-fix", () =>
          ctx.git.commit(branch, { diff: againDiff, message: `fix: address review of ${label}` }),
        );
        review = record("pr-review", await runReview(ctx, input.base, branch, report));
      }
    }

    // 6. the shared PR tail: describe, then a draft PR and an issue comment.
    const pr = await openPr(ctx, {
      branch,
      base: input.base,
      issue: input.issue,
      report,
      evidence,
      reproOnly: false,
      review,
    });
    steps.push(...pr.steps);
    const open = review.ok ? (review.output as Review).unaddressed : [];
    await comment(
      ctx,
      input,
      open.length > 0
        ? `Orca opened a draft PR for ${label}, but its review says part of the issue is still open:\n${open.map((u) => `- ${u}`).join("\n")}\n\n${pr.url}`
        : `Orca opened a draft PR for ${label}:\n${pr.url}`,
    );

    return done("pr_opened", {
      prUrl: pr.url,
      branch,
      verdict: pr.verdict,
      steps,
      costUsd: sum(steps),
    });
  },
});

// ── The PR tail ───────────────────────────────────────────────

interface OpenPrInput {
  branch: string;
  base: string;
  issue: number | undefined;
  report: string;
  evidence: Evidence[];
  reproOnly: boolean;
  review?: RunResult | undefined; // already reviewed by the chain; otherwise reviewed here
}

interface OpenPrResult {
  url: string;
  verdict: Verdict;
  steps: BugToPrStep[];
}

/**
 * Review the branch (unless the chain already did) and, when there's a fix,
 * describe it, then open a draft PR whose body carries both. Review failures
 * never block the PR: a branch that can't be reviewed opens marked "not reviewed",
 * and request_changes opens with the review in the body — a person still decides.
 * A repro-only PR skips pr-describe: there's no fix to describe, and its title
 * says so plainly. Steps already recorded by the chain aren't returned again.
 */
async function openPr(ctx: ChainCtx, p: OpenPrInput): Promise<OpenPrResult> {
  const steps: BugToPrStep[] = [];
  const issue = p.issue !== undefined ? { number: p.issue, text: p.report } : undefined;

  const [describe, review] = await ctx.step("pr-tail", () =>
    Promise.all([
      p.reproOnly
        ? Promise.resolve(null)
        : ctx.run("pr-describe", { base: p.base, head: p.branch, issue, evidence: p.evidence }),
      p.review ? Promise.resolve(p.review) : runReview(ctx, p.base, p.branch, p.report),
    ]),
  );
  if (describe) steps.push({ name: "pr-describe", ok: describe.ok, costUsd: describe.costUsd });
  if (!p.review) steps.push({ name: "pr-review", ok: review.ok, costUsd: review.costUsd });

  const description = describe?.ok ? (describe.output as PrDescribeResult | null) : null;
  const reviewOut = review.ok ? (review.output as Review) : null;
  const verdict: Verdict = reviewOut ? reviewOut.verdict : "not_reviewed";

  // A described fix uses the generated title; a repro-only PR says "no fix yet".
  const title = p.reproOnly ? reproTitle(p) : (description?.title ?? reproTitle(p));
  const body = renderBody({
    description: description?.body,
    review: reviewOut,
    reproOnly: p.reproOnly,
    issue: p.issue,
  });

  const { url } = await ctx.pr.open({ branch: p.branch, base: p.base, title, body, draft: true });
  return { url, verdict, steps };
}

function reproTitle(p: OpenPrInput): string {
  const ref = p.issue !== undefined ? `#${p.issue}` : "a reported bug";
  return p.reproOnly ? `Repro for ${ref} (no fix yet)` : `Fix for ${ref}`;
}

function renderBody(p: {
  description: string | undefined;
  review: Review | null;
  reproOnly: boolean;
  issue: number | undefined;
}): string {
  const parts: string[] = [];
  if (p.description) {
    parts.push(p.description);
  } else {
    if (p.issue !== undefined) parts.push(`Fixes #${p.issue}`);
    parts.push(
      p.reproOnly
        ? "This PR adds a failing test that reproduces the reported bug. Orca could not fix it automatically; the test is here for a person to build on."
        : "This PR reproduces and fixes a reported bug.",
    );
  }
  parts.push(renderReview(p.review));
  return parts.join("\n\n");
}

function renderReview(review: Review | null): string {
  if (!review) return "## Review\nOrca did not produce a review for this branch (not reviewed).";
  const lines = [`## Review (orca, ${review.verdict})`, review.summary];
  for (const c of review.comments) {
    lines.push(`- ${c.severity} \`${c.file}:${c.line}\`: ${c.body}`);
  }
  if (review.unaddressed.length > 0) {
    lines.push("", "**Not yet resolved from the issue:**");
    for (const u of review.unaddressed) lines.push(`- ${u}`);
  }
  return lines.join("\n");
}

function runReview(ctx: ChainCtx, base: string, head: string, report: string): Promise<RunResult> {
  return ctx.run("pr-review", { base, head, issue: report });
}

/** What a request_changes review asks for, as fix-ci feedback; [] on approve. */
function feedbackOf(review: Review): string[] {
  if (review.verdict !== "request_changes") return [];
  return [
    ...review.comments
      .filter((c) => c.severity === "blocking")
      .map((c) => `${c.file}:${c.line}: ${c.body}`),
    ...review.unaddressed.map((u) => `Not resolved yet: ${u}`),
  ];
}

// ── Small helpers ─────────────────────────────────────────────

function reproInput(input: BugToPrInput, report: string): Record<string, unknown> {
  return input.issue !== undefined
    ? { report, test: input.test, issue: input.issue }
    : { report, test: input.test };
}

function buildEvidence(repro: RunResult, fix: RunResult, command: string): Evidence[] {
  return [
    {
      recipe: "repro-bug",
      ok: repro.ok,
      gatesPassed: REPRO_GATES,
      summary: `wrote a test that fails on the current code (\`${command}\`)`,
    },
    {
      recipe: "fix-ci",
      ok: fix.ok,
      gatesPassed: FIXCI_GATES,
      summary: fix.ok
        ? `fixed the source so \`${command}\` passes, with no test or config edits`
        : "could not make the test pass within budget",
    },
  ];
}

function comment(ctx: ChainCtx, input: BugToPrInput, body: string): Promise<void> {
  if (input.issue === undefined) return Promise.resolve();
  const issue = input.issue;
  return ctx.step("comment-issue", () => ctx.pr.comment(issue, body));
}

function diffOf(r: RunResult): string {
  const diff = r.tasks[0]?.diff;
  if (!diff) throw new Error(`${r.status} run produced no diff to commit`);
  return diff;
}

function commandOf(r: RunResult): string | undefined {
  const out = r.output as { command?: unknown } | undefined;
  return typeof out?.command === "string" ? out.command : undefined;
}

function reasonOf(r: RunResult): string {
  const out = r.output as { reason?: unknown } | undefined;
  if (typeof out?.reason === "string" && out.reason.trim()) return out.reason;
  return r.error?.message ?? "No reproducing test passed the gates.";
}

/**
 * Which limit cut a run short, if any. A run-wide budget or time stop surfaces as
 * a `partial` run; a worker's own turns or per-attempt time limit doesn't — its
 * error becomes the task's failure reason (engine task.ts), so it's read from there.
 */
function stoppedEarly(r: RunResult): "budget" | "time" | "turns" | null {
  if (r.error?.kind === "budget") return "budget";
  if (r.error?.kind === "timeout") return "time";
  const failures = r.tasks.flatMap((t) => t.failures ?? []);
  if (failures.some((f) => f.startsWith("worker failed: max_turns"))) return "turns";
  if (failures.some((f) => f.startsWith("worker failed: timeout"))) return "time";
  return null;
}

function workerSaidCannotReproduce(r: RunResult): boolean {
  return (r.output as { cannotReproduce?: unknown } | undefined)?.cannotReproduce === true;
}

function sum(steps: BugToPrStep[]): number {
  return steps.reduce((t, s) => t + s.costUsd, 0);
}

function done(status: BugToPrStatus, rest: Omit<BugToPrOutput, "status">): BugToPrOutput {
  return { status, ...rest };
}
