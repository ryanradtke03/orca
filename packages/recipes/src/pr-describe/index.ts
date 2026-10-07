import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  claimsMatchEvidence,
  closesIssue,
  defineRecipe,
  type Evidence,
  mentionsOnlyDiffFiles,
  onlyTouches,
  outputMatches,
} from "@orchestra/engine";
import { extractJson } from "@orchestra/messenger";
import { z } from "zod";
import { changedFiles, trim } from "../shared/diff.js";

// The PR description the worker must return, as JSON in its final message. Kept as
// a plain object (PrDescriptionObject) so the prompt can carry its JSON Schema, and
// re-exported with its refinements as PrDescriptionSchema for the gate.
const PrDescriptionObject = z.object({
  title: z.string().min(10).max(72), // fits a PR title; GitHub truncates past ~72
  summary: z.string().max(800), // why the change exists, in plain words
  changes: z.array(z.object({ file: z.string(), what: z.string().max(200) })).max(20), // one row per file or group; grouped for big mechanical changes
  testing: z.array(z.object({ claim: z.string(), evidence: z.string() })), // each cites a gate/run
  risks: z.array(z.string()).max(5),
  closes: z.number().int().optional(), // the issue this PR closes
});

export const PrDescriptionSchema = PrDescriptionObject;

export type PrDescription = z.infer<typeof PrDescriptionSchema>;

/** What finish() returns: the PR title, the rendered body, and the parsed object. */
export interface PrDescribeResult {
  title: string;
  body: string; // rendered markdown
  parsed: PrDescription;
}

const DIFF_BUDGET = 20000; // chars of diff that go into the prompt

interface DescribeContext extends Record<string, unknown> {
  base: string;
  head: string;
  diff: string;
  files: string[]; // changed paths, for mentionsOnlyDiffFiles
  commits: string;
  issue: { number: number; text: string } | undefined;
  evidence: Evidence[]; // for claimsMatchEvidence
  template: string | undefined; // the repo's PR template, if any
}

const ctxOf = (context: Record<string, unknown>) => context as DescribeContext;

/** Read `.github/pull_request_template.md` if the repo has one, else undefined. */
async function readPrTemplate(repo: string): Promise<string | undefined> {
  try {
    return (await readFile(path.join(repo, ".github/pull_request_template.md"), "utf8")).trim();
  } catch {
    return undefined;
  }
}

/** The run evidence as a few lines for the prompt — recipe, outcome, gates. */
function formatEvidence(evidence: Evidence[]): string {
  return evidence
    .map((e) => {
      const gates = e.gatesPassed.length ? ` [${e.gatesPassed.join(", ")}]` : "";
      return `- ${e.recipe}: ${e.ok ? "passed" : "failed"}${gates}${e.summary ? ` — ${e.summary}` : ""}`;
    })
    .join("\n");
}

/**
 * Turn a validated PrDescription into the PR body (markdown). The title is the PR's
 * own field, so it isn't repeated here; the body opens with "Fixes #N" when the
 * change closes an issue, then the summary and the sections that have content.
 */
export function render(d: PrDescription): string {
  const parts: string[] = [];
  if (d.closes !== undefined) parts.push(`Fixes #${d.closes}`);
  parts.push(d.summary);
  if (d.changes.length) {
    parts.push(`## Changes\n${d.changes.map((c) => `- \`${c.file}\` — ${c.what}`).join("\n")}`);
  }
  parts.push(
    d.testing.length
      ? `## Testing\n${d.testing.map((t) => `- ${t.claim} (${t.evidence})`).join("\n")}`
      : "## Testing\nNo automated checks were run as part of this change.",
  );
  if (d.risks.length) parts.push(`## Risks\n${d.risks.map((r) => `- ${r}`).join("\n")}`);
  parts.push("—\n*Description drafted by orca pr-describe.*");
  return parts.join("\n\n");
}

export const prDescribe = defineRecipe({
  name: "pr-describe",
  description:
    "Write a PR title and description from a branch's diff, its issue, and the evidence of the runs that produced it, without editing anything and without claiming any testing that didn't actually run",
  input: z.object({
    base: z.string().default("main"),
    head: z.string(), // the branch to describe
    issue: z.object({ number: z.number(), text: z.string() }).optional(),
    // results from the runs that built this branch; empty when run by hand
    evidence: z
      .array(
        z.object({
          recipe: z.string(),
          ok: z.boolean(),
          gatesPassed: z.array(z.string()).default([]),
          summary: z.string().optional(),
        }),
      )
      .default([]),
    template: z.string().optional(), // the repo's PR template, if it has one
  }),

  async plan(input, ctx) {
    const diff = (await ctx.exec(`git diff ${input.base}...${input.head}`)).output;
    if (!diff.trim()) return []; // nothing to describe
    const log = (await ctx.exec(`git log --oneline ${input.base}..${input.head}`)).output;
    const context: DescribeContext = {
      base: input.base,
      head: input.head,
      diff: trim(diff, DIFF_BUDGET),
      files: changedFiles(diff),
      commits: log.trim(),
      issue: input.issue,
      evidence: input.evidence,
      template: input.template ?? (await readPrTemplate(ctx.repo)),
    };
    return [
      {
        id: "describe",
        goal: `Write the PR title and description for ${input.head}`,
        dependsOn: [],
        context,
      },
    ];
  },

  worker: (task) => {
    const c = ctxOf(task.context);
    return {
      prompt: [
        "Write a PR title and description for this change. You can read any file in the repo for context.",
        c.issue &&
          `It addresses issue #${c.issue.number}:\n"""\n${c.issue.text}\n"""\nSet "closes" to ${c.issue.number}.`,
        `Diff:\n\`\`\`diff\n${c.diff}\n\`\`\``,
        c.commits && `Commits:\n${c.commits}`,
        `What actually ran and passed:\n${
          formatEvidence(c.evidence) ||
          "(nothing — say testing was not run and leave testing empty)"
        }`,
        "Only describe testing that appears in that list, and cite it in each entry's evidence." +
          " Only mention files that appear in the diff; describe every file it changed, grouping" +
          " a mechanical change over many files under one entry (a directory path).",
        "Keep the summary to why the change exists, in a few sentences; put per-file detail in changes.",
        c.template && `Follow this PR template where it fits:\n${c.template}`,
        `Your final message must be ONLY JSON matching this schema, no prose or code fences:\n${JSON.stringify(
          z.toJSONSchema(PrDescriptionObject),
        )}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      tools: ["Read", "Grep", "Glob"], // read-only: no Edit, Write or Bash
      maxTurns: 12,
    };
  },

  gates: [
    // cheap: a description edits nothing — the worktree stays clean.
    onlyTouches([]),
    // cheap: the final message is JSON and matches the schema (title ≤ 72, etc.).
    outputMatches(PrDescriptionSchema),
    // cheap: changes name only diff files, and cover every changed file.
    mentionsOnlyDiffFiles((task) => ctxOf(task.context).files),
    // cheap: when an issue was given, the description links it.
    closesIssue((task) => ctxOf(task.context).issue?.number),
    // cheap: every testing claim points at evidence that really ran.
    claimsMatchEvidence((task) => ctxOf(task.context).evidence),
  ],

  async finish(results): Promise<PrDescribeResult | null> {
    const task = results[0];
    if (!task) return null; // empty diff: plan returned no tasks
    const parsed = PrDescriptionSchema.safeParse(extractJson(task.output ?? ""));
    // The gates passed before we get here, so a well-formed description is expected;
    // return null only if the run reached finish() some other way.
    if (!parsed.success) return null;
    return { title: parsed.data.title, body: render(parsed.data), parsed: parsed.data };
  },
});
