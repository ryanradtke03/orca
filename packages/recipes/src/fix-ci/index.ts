import { commandPasses, defineRecipe, noFileChanges, noPattern } from "@orchestra/engine";
import { z } from "zod";

const TEST_AND_CONFIG = [
  /\.test\.[cm]?[jt]sx?$/,
  /__tests__\//,
  /^tsconfig.*\.json$/,
  /^package\.json$/,
  /vitest\.config/,
  // CI, lockfiles and orca's own config: fix-ci's prompt can carry issue text (a
  // stranger's words), so a "fix" must never reach the pipeline that checks it.
  /^\.github\//,
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/,
  /^(\.orca\.json|orca\.config\.ts)$/,
];
const CHEATS = [
  /@ts-ignore/,
  /@ts-expect-error/,
  /@ts-nocheck/,
  /eslint-disable/,
  /\.(skip|only)\(/,
  /\bas any\b/,
];

export const fixCi = defineRecipe({
  name: "fix-ci",
  description: "Make a failing command pass without touching tests or config",
  input: z.object({
    command: z.string().default("pnpm check"),
    // The bug report the failure reproduces, so the fix targets the report, not
    // just the tests (bug-to-pr passes it).
    issue: z.string().optional(),
    // Review findings to address. With feedback the worker runs even when the
    // command is already green — the point is to fix what the review found.
    feedback: z.array(z.string()).default([]),
  }),

  async plan(input, ctx) {
    const first = await ctx.exec(input.command);
    const green = first.code === 0;
    if (green && input.feedback.length === 0) return []; // already green: no worker
    return [
      {
        id: "fix",
        goal: green
          ? `Address the review feedback while keeping \`${input.command}\` passing`
          : `Make \`${input.command}\` pass`,
        dependsOn: [],
        context: {
          command: input.command,
          failure: green ? "" : tail(first.output, 6000),
          issue: input.issue ?? "",
          feedback: input.feedback,
        },
      },
    ];
  },

  worker: (task) => {
    const command = String(task.context["command"]);
    const failure = String(task.context["failure"] ?? "");
    const issue = String(task.context["issue"] ?? "");
    const feedback = (task.context["feedback"] as string[] | undefined) ?? [];
    return {
      prompt: [
        `${task.goal}. Fix the root cause in the source code.`,
        failure && `Current failure:\n\`\`\`\n${failure}\n\`\`\``,
        issue &&
          `The tests reproduce this bug report:\n"""\n${issue}\n"""\n` +
            "Fix everything the report describes, not only what the tests check. Where the" +
            " report leaves the approach open, pick one and keep it consistent.",
        feedback.length > 0 &&
          `A reviewer found these problems with the current fix. Address each one:\n${feedback
            .map((f) => `- ${f}`)
            .join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      tools: [
        "Read",
        "Edit",
        "Write", // a whole-issue fix may need a new module; noFileChanges still guards tests
        "Grep",
        "Glob",
        `Bash(${command})`,
        "Bash(pnpm test:*)",
        "Bash(pnpm typecheck:*)",
      ],
      maxTurns: 25,
    };
  },

  gates: [
    noFileChanges(TEST_AND_CONFIG), // cheap: file names only
    noPattern(CHEATS), // cheap: added lines only
    commandPasses((task) => String(task.context["command"])), // expensive: run it
  ],

  async finish(results) {
    return {
      fixed: results.every((r) => r.ok), // [] (already green) → true
      diffs: results.map((r) => r.diff),
    };
  },
});

function tail(s: string, max: number) {
  return s.length > max ? "…" + s.slice(-max) : s;
}
