// Bug to PR: a bug report in, a draft PR out — with a test that proves the bug,
// a fix that makes it pass, and a review. Three child runs, two git commits and a
// PR step, sequenced as one chain under one budget (Recipe Catalog, phase 5).
//
//   repro-bug  → commit the failing test → fix-ci → commit the fix
//              → (pr-describe ∥ pr-review) → open a draft PR → comment the issue
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
    const branch = `orca/bug-${input.issue ?? ctx.runId}`;
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
    if (!repro.ok) {
      await comment(
        ctx,
        input,
        `Orca couldn't reproduce ${label} as a failing test.\n\n${reasonOf(repro)}`,
      );
      return done("cannot_reproduce", { steps, costUsd: repro.costUsd });
    }

    // 2. commit the failing test onto the result branch (your checkout never moves).
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
    const fix = record("fix-ci", await ctx.run("fix-ci", { command }, { base: branch }));

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

    // 5. the shared PR tail: describe + review, then a draft PR and an issue comment.
    const pr = await openPr(ctx, {
      branch,
      base: input.base,
      issue: input.issue,
      report,
      evidence,
      reproOnly: false,
    });
    steps.push(...pr.steps);
    await comment(ctx, input, `Orca opened a draft PR for ${label}:\n${pr.url}`);

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
}

interface OpenPrResult {
  url: string;
  verdict: Verdict;
  steps: BugToPrStep[];
}

/**
 * Review the branch and (when there's a fix) describe it, then open a draft PR
 * whose body carries both. Review failures never block the PR: a branch that
 * can't be reviewed opens marked "not reviewed", and request_changes opens with
 * the review in the body — a person still decides. A repro-only PR skips
 * pr-describe: there's no fix to describe, and its title says so plainly.
 */
async function openPr(ctx: ChainCtx, p: OpenPrInput): Promise<OpenPrResult> {
  const steps: BugToPrStep[] = [];
  const issue = p.issue !== undefined ? { number: p.issue, text: p.report } : undefined;

  const [describe, review] = await ctx.step("pr-tail", () =>
    Promise.all([
      p.reproOnly
        ? Promise.resolve(null)
        : ctx.run("pr-describe", { base: p.base, head: p.branch, issue, evidence: p.evidence }),
      ctx.run("pr-review", { base: p.base, head: p.branch, issue: p.report }),
    ]),
  );
  if (describe) steps.push({ name: "pr-describe", ok: describe.ok, costUsd: describe.costUsd });
  steps.push({ name: "pr-review", ok: review.ok, costUsd: review.costUsd });

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
  return lines.join("\n");
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

function sum(steps: BugToPrStep[]): number {
  return steps.reduce((t, s) => t + s.costUsd, 0);
}

function done(status: BugToPrStatus, rest: Omit<BugToPrOutput, "status">): BugToPrOutput {
  return { status, ...rest };
}
