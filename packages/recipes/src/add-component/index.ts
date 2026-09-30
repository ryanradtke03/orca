import { existsSync } from "node:fs";
import path from "node:path";
import { defineRecipe, type Gate } from "@orchestra/engine";
import { z } from "zod";

// Each task carries its target file in context; this gate checks that the
// worker actually created it. Context-aware, so one gate works for every task.
const fileCreated: Gate = {
  name: "fileCreated",
  async check(ctx) {
    const file = String(ctx.task.context["file"]);
    if (existsSync(path.join(ctx.worktree, file))) return { ok: true };
    return { ok: false, reasons: [`${file} was not created`] };
  },
};

/**
 * add-component: scaffold a component, then a test and a story that depend on it.
 * The test and story fan out from the component and run in parallel.
 */
export const addComponent = defineRecipe({
  name: "add-component",
  description: "Scaffold a component with a matching test and story",
  input: z.object({
    name: z.string(), // e.g. "UserCard"
    dir: z.string().default("src/components"),
  }),

  async plan(input) {
    const base = `${input.dir}/${input.name}`;
    return [
      {
        id: "component",
        goal: `Create the ${input.name} component`,
        dependsOn: [],
        context: { ...input, file: `${base}.tsx` },
      },
      {
        id: "test",
        goal: `Write a test for ${input.name}`,
        dependsOn: ["component"],
        context: { ...input, file: `${base}.test.tsx` },
      },
      {
        id: "story",
        goal: `Write a story for ${input.name}`,
        dependsOn: ["component"],
        context: { ...input, file: `${base}.stories.tsx` },
      },
    ];
  },

  worker: (task) => {
    const file = String(task.context["file"]);
    return {
      prompt: `${task.goal}. Write it to ${file}. Keep it idiomatic and self-contained.`,
      tools: ["Read", "Write", "Edit", "Glob", "Grep"],
      allowEdits: [file],
      maxTurns: 15,
    };
  },

  gates: [fileCreated],

  async finish(results) {
    return {
      ok: results.every((r) => r.ok),
      created: results.filter((r) => r.ok).map((r) => String(r.task.context["file"])),
    };
  },
});
