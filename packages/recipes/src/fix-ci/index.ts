import { commandPasses, defineRecipe, noFileChanges, noPattern } from "@orchestra/engine";
import { z } from "zod";

const TEST_AND_CONFIG = [
  /\.test\.[cm]?[jt]sx?$/,
  /__tests__\//,
  /^tsconfig.*\.json$/,
  /^package\.json$/,
  /vitest\.config/,
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
  input: z.object({ command: z.string().default("pnpm check") }),

  async plan(input, ctx) {
    const first = await ctx.exec(input.command);
    if (first.code === 0) return []; // already green: no worker
    return [
      {
        id: "fix",
        goal: `Make \`${input.command}\` pass`,
        dependsOn: [],
        context: { command: input.command, failure: tail(first.output, 6000) },
      },
    ];
  },

  worker: (task) => {
    const command = String(task.context["command"]);
    return {
      prompt: [
        `${task.goal}. Fix the root cause in the source code.`,
        `Current failure:\n\`\`\`\n${String(task.context["failure"])}\n\`\`\``,
      ].join("\n\n"),
      tools: [
        "Read",
        "Edit",
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
