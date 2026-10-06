import { anchoredInDiff, defineRecipe, onlyTouches, outputMatches } from "@orchestra/engine";
import { extractJson } from "@orchestra/messenger";
import { z } from "zod";
import { parseHunks, trim } from "../shared/diff.js";

// The review the worker must return, as JSON in its final message. Kept as a plain
// object (ReviewObject) for the JSON Schema in the prompt, plus a refinement that
// the gate enforces: a review requests changes exactly when it has a blocking
// comment, so there's no "approve with blockers" or "request changes" with nothing
// to point at.
const ReviewObject = z.object({
  verdict: z.enum(["approve", "request_changes"]),
  summary: z.string().max(1000),
  comments: z
    .array(
      z.object({
        file: z.string(),
        line: z.number().int(),
        severity: z.enum(["blocking", "suggestion"]),
        body: z.string().max(800),
      }),
    )
    .max(15),
});

export const ReviewSchema = ReviewObject.refine(
  (r) => (r.verdict === "request_changes") === r.comments.some((c) => c.severity === "blocking"),
  "request_changes if and only if there is a blocking comment",
);

export type Review = z.infer<typeof ReviewSchema>;

const DIFF_BUDGET = 20000; // chars of diff that go into the prompt

interface ReviewContext extends Record<string, unknown> {
  head: string;
  base: string;
  diff: string;
  hunks: Record<string, [number, number][]>; // file → changed line ranges, for the anchor gate
  issue: string;
  focus: string[];
}

const ctxOf = (context: Record<string, unknown>) => context as ReviewContext;

const EMPTY_REVIEW: Review = {
  verdict: "approve",
  summary: "No changes to review.",
  comments: [],
};

export const prReview = defineRecipe({
  name: "pr-review",
  description:
    "Review a branch's changes against a base and return a structured verdict with comments pinned to lines the diff actually changed, without editing anything",
  input: z.object({
    base: z.string().default("main"),
    head: z.string(), // the branch to review
    issue: z.string().optional(), // what the change is supposed to do
    focus: z
      .array(z.string())
      .default([
        "fixes the root cause, not just the test",
        "behavior changes outside the issue",
        "missing edge cases",
      ]),
  }),

  async plan(input, ctx) {
    const diff = (await ctx.exec(`git diff ${input.base}...${input.head}`)).output;
    if (!diff.trim()) return []; // nothing to review
    const context: ReviewContext = {
      head: input.head,
      base: input.base,
      diff: trim(diff, DIFF_BUDGET),
      hunks: parseHunks(diff),
      issue: input.issue ?? "",
      focus: input.focus,
    };
    return [
      {
        id: "review",
        goal: `Review the changes on ${input.head} against ${input.base}`,
        dependsOn: [],
        context,
      },
    ];
  },

  worker: (task) => {
    const c = ctxOf(task.context);
    return {
      prompt: [
        c.issue && `The change is meant to address:\n"""\n${c.issue}\n"""`,
        `Review this diff. You can read any file in the repo for context.\n\`\`\`diff\n${c.diff}\n\`\`\``,
        `Look for: ${c.focus.join("; ")}.`,
        'Comment only on lines the diff adds or changes. Mark a comment "blocking" only if' +
          ' the change is wrong or incomplete; otherwise "suggestion". Request changes exactly' +
          " when you leave a blocking comment.",
        "Only comment when it genuinely helps the author. If the change is sound, approve with" +
          " an empty comments list — do not manufacture nitpicks, style notes, or hypothetical" +
          ' "if this were reused differently" concerns just to have something to say.',
        "Keep the summary to a few sentences (under 1000 characters); put specifics in comments.",
        `Your final message must be ONLY JSON matching this schema, no prose or code fences:\n${JSON.stringify(
          z.toJSONSchema(ReviewObject),
        )}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      tools: ["Read", "Grep", "Glob"], // read-only: no Edit, Write or Bash
      maxTurns: 20,
    };
  },

  gates: [
    // cheap: a reviewer must not change anything — the worktree stays clean.
    onlyTouches([]),
    // cheap: the final message is JSON, matches the schema, and obeys the verdict rule.
    outputMatches(ReviewSchema),
    // cheap: every comment points at a line the diff actually changed.
    anchoredInDiff((task) => ctxOf(task.context).hunks),
  ],

  async finish(results): Promise<Review> {
    const task = results[0];
    if (!task) return EMPTY_REVIEW; // empty diff: plan returned no tasks
    const parsed = ReviewSchema.safeParse(extractJson(task.output ?? ""));
    // The gates passed before we get here, so a well-formed review is expected;
    // fall back only if the run failed its way to finish() some other way.
    return parsed.success ? parsed.data : EMPTY_REVIEW;
  },
});
