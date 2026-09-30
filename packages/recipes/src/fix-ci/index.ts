import { commandPasses, defineRecipe, noPattern } from "@orchestra/engine";
import { z } from "zod";

/**
 * fix-ci: make a failing command pass. One task, one worker, two gates —
 * the command must exit 0, and the worker can't cheat by disabling type or lint checks.
 */
export const fixCi = defineRecipe({
  name: "fix-ci",
  description: "Make a failing command pass",
  input: z.object({ command: z.string() }), // e.g. "pnpm tsc --noEmit"

  async plan(input) {
    return [
      {
        id: "fix",
        goal: `Make \`${input.command}\` pass`,
        dependsOn: [],
        context: input,
      },
    ];
  },

  worker: (task) => {
    const command = String(task.context["command"]);
    return {
      prompt: `${task.goal}. Run it, read the errors, fix the code. Don't disable checks or add ts-ignore.`,
      tools: ["Read", "Edit", "Grep", "Glob", `Bash(${command})`],
      maxTurns: 25,
    };
  },

  gates: [
    commandPasses((task) => String(task.context["command"])), // the command must exit 0
    noPattern([/@ts-ignore/, /eslint-disable/]), // no cheating
  ],

  async finish(results) {
    return {
      fixed: results.every((r) => r.ok),
      diffs: results.map((r) => r.diff),
    };
  },
});
