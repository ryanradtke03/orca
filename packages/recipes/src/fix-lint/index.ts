import {
  commandPasses,
  defineRecipe,
  noFileChanges,
  noPattern,
  onlyTouches,
} from "@orchestra/engine";
import { z } from "zod";
import { type LintError, parseLintJson } from "./biome.js";

// Lint config, ignore files and the files that decide the rules. Editing any of
// them is a way to make the linter pass without fixing the code, so the first
// gate rejects a diff that touches them. (noFileChanges matches on path.)
const LINT_CONFIG = [
  /^biome\.jsonc?$/,
  /^\.eslintrc/,
  /^eslint\.config\./,
  /^\.(eslint|biome)ignore$/,
  /^package\.json$/,
  /^tsconfig.*\.json$/,
];
// Suppression comments and escape hatches: silence a rule instead of fixing it.
// Checked on added lines only, so pre-existing ones don't fail the gate.
const CHEATS = [/@ts-ignore/, /@ts-expect-error/, /@ts-nocheck/, /\bas any\b/];
const SUPPRESS = [/biome-ignore/, /eslint-disable/];

interface LintContext extends Record<string, unknown> {
  files: string[];
  byRule: Record<string, number>;
  messages: string;
  lint: string;
  check: string;
  errorsBefore: number;
  remaining: number;
}

const ctxOf = (context: Record<string, unknown>) => context as LintContext;

export const fixLint = defineRecipe({
  name: "fix-lint",
  description: "Clear lint errors in a file or folder without disabling rules or changing behavior",
  input: z.object({
    lint: z.string().default("pnpm lint"), // must support a JSON reporter
    check: z.string().default("pnpm check"), // behavior check: typecheck + tests
    paths: z.array(z.string()).default(["."]), // scope
    maxFiles: z.number().int().min(1).default(20), // keep each diff reviewable
  }),

  async plan(input, ctx) {
    const res = await ctx.exec(`${input.lint} --reporter=json ${input.paths.join(" ")}`);
    const errors = parseLintJson(res.output, ctx.repo).filter((e) => e.severity === "error");
    if (errors.length === 0) return []; // already clean: no worker, $0

    const byFile = groupBy(errors, (e) => e.file);
    const allFiles = Object.keys(byFile);
    const files = allFiles.slice(0, input.maxFiles);
    const inScope = files.flatMap((f) => byFile[f] ?? []);

    const context: LintContext = {
      files, // the scope gate reads this
      byRule: countBy(inScope, (e) => e.rule), // e.g. { noExplicitAny: 6, noDoubleEquals: 3 }
      messages: formatMessages(files, byFile, 6000), // trimmed, grouped by file
      lint: input.lint,
      check: input.check,
      errorsBefore: inScope.length,
      remaining: allFiles.length - files.length,
    };
    return [
      {
        id: "lint",
        goal: `Fix ${inScope.length} lint error(s) in ${files.length} file(s)`,
        dependsOn: [],
        context,
      },
    ];
  },

  worker: (task) => {
    const c = ctxOf(task.context);
    return {
      prompt: [
        `${task.goal}. Only edit these files:\n${c.files.join("\n")}`,
        "Start with `pnpm lint:fix` to apply safe autofixes, then fix what's left by hand.",
        `Keep behavior the same: \`${c.check}\` must still pass.`,
        `Errors by rule: ${JSON.stringify(c.byRule)}`,
        `Messages:\n${c.messages}`,
      ].join("\n\n"),
      tools: ["Read", "Edit", "Grep", "Glob", "Bash(pnpm lint:*)", `Bash(${c.check})`],
      maxTurns: 30,
    };
  },

  gates: [
    noFileChanges(LINT_CONFIG), // cheap: don't touch the rules
    onlyTouches((task) => ctxOf(task.context).files), // cheap: only files that had errors
    noPattern([...CHEATS, ...SUPPRESS]), // cheap: no suppressions on added lines
    commandPasses((task) => {
      const c = ctxOf(task.context);
      return `${c.lint} ${c.files.join(" ")}`;
    }), // medium: the linter is clean on the scoped files
    commandPasses((task) => ctxOf(task.context).check), // expensive: behavior unchanged
  ],

  async finish(results) {
    const task = results[0]; // one task, or none when already clean
    const c = task ? ctxOf(task.task.context) : null;
    return {
      fixed: results.every((r) => r.ok), // [] (already clean) → true
      files: c?.files ?? [],
      errorsBefore: c?.errorsBefore ?? 0,
      byRule: c?.byRule ?? {},
      remaining: c?.remaining ?? 0,
      diffs: results.map((r) => r.diff),
    };
  },
});

// ── Plan helpers ──────────────────────────────────────────────

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    const bucket = out[k];
    if (bucket) bucket.push(item);
    else out[k] = [item];
  }
  return out;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

/**
 * The errors grouped by file, as text for the worker's prompt. Trimmed to `max`
 * characters so a file with hundreds of errors can't blow up the context.
 */
function formatMessages(files: string[], byFile: Record<string, LintError[]>, max: number): string {
  const blocks = files.map((file) => {
    const lines = (byFile[file] ?? []).map((e) => `  ${e.line}: ${e.rule} — ${e.message}`);
    return `${file}\n${lines.join("\n")}`;
  });
  const text = blocks.join("\n\n");
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}
