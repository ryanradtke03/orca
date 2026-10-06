import {
  commandPasses,
  countNotLess,
  defineRecipe,
  failsOnBase,
  noPattern,
  onlyTouches,
} from "@orchestra/engine";
import { z } from "zod";
import { parseVitestJson, type TestFailure } from "../shared/vitest.js";

// Ways to silence a test instead of updating it: skips, todos, and catch-all
// matchers that pass no matter what the code does. Checked on added lines only.
const CHEATS = [
  /@ts-ignore/,
  /@ts-expect-error/,
  /@ts-nocheck/,
  /\.(skip|only|todo|fails)\(/,
  /expect\.anything\(\)/,
  /\bas any\b/,
];

const EXPECT = /\bexpect\(/; // one assertion
const TEST = /\b(it|test)\(/; // one test case

interface UpdateContext extends Record<string, unknown> {
  files: string[];
  base: string;
  reason: string;
  srcDiff: string;
  failures: string;
  test: string;
}

const ctxOf = (context: Record<string, unknown>) => context as UpdateContext;

export const updateTests = defineRecipe({
  name: "update-tests",
  description:
    "The source changed on purpose; update the stale tests to match the new behavior without touching the source or weakening the tests",
  input: z.object({
    test: z.string().default("pnpm test"), // must support a JSON reporter
    base: z.string().default("HEAD~1"), // the commit before the intentional change
    reason: z.string().optional(), // why the source changed, in a sentence
  }),

  async plan(input, ctx) {
    const run = await ctx.exec(`${input.test} --reporter=json`);
    const failing = parseVitestJson(run.output, ctx.repo);
    if (failing.length === 0) return []; // nothing stale: no worker, $0

    // The source diff is the key context — it tells the worker what the new
    // behavior is. With no source change there's nothing to update tests to, so
    // this recipe doesn't apply (plan throws → plan_failed, before any tokens).
    const srcDiff = await ctx.exec(`git diff ${input.base} HEAD -- src`);
    if (srcDiff.output.trim() === "") {
      throw new Error(
        `no source changes between ${input.base} and HEAD under src/; ` +
          "the tests are failing for some other reason — run fix-ci instead",
      );
    }

    const files = unique(failing.map((f) => f.file)).filter(Boolean);
    const context: UpdateContext = {
      files,
      base: input.base,
      reason: input.reason ?? "",
      srcDiff: tail(srcDiff.output, 8000),
      failures: formatFailures(failing, 6000),
      test: input.test,
    };
    return [
      {
        id: "update",
        goal: `Update ${failing.length} failing test(s) in ${files.length} file(s) to match the intended change`,
        dependsOn: [],
        context,
      },
    ];
  },

  worker: (task) => {
    const c = ctxOf(task.context);
    return {
      prompt: [
        `The source changed on purpose${c.reason ? `: ${c.reason}` : ""}.`,
        `${task.goal}. Only edit these test files:\n${c.files.join("\n")}`,
        "Make each test describe the new behavior. Keep every test and assertion; " +
          "change what they expect, not whether they check it.",
        `Source change:\n\`\`\`diff\n${c.srcDiff}\n\`\`\``,
        `Failing tests:\n${c.failures}`,
      ].join("\n\n"),
      tools: ["Read", "Edit", "Grep", "Glob", "Bash(pnpm test:*)", "Bash(pnpm vitest:*)"],
      maxTurns: 30,
    };
  },

  gates: [
    // cheap: only the failing test files (and their snapshots) may change
    onlyTouches((task) => [...ctxOf(task.context).files, "**/__snapshots__/**"]),
    // cheap: no skips, todos or catch-all matchers added
    noPattern(CHEATS),
    // cheap: assertions and test cases can't be deleted to make the suite pass
    countNotLess(EXPECT, (task) => ctxOf(task.context).files),
    countNotLess(TEST, (task) => ctxOf(task.context).files),
    // expensive: the tests actually pass now
    commandPasses((task) => ctxOf(task.context).test),
    // expensive: and they fail on the old source, so they check the change
    failsOnBase(
      (task) => ctxOf(task.context).base,
      "src",
      (task) => ctxOf(task.context).test,
    ),
  ],

  async finish(results) {
    const task = results[0]; // one task, or none when nothing was stale
    const c = task ? ctxOf(task.task.context) : null;
    return {
      updated: results.every((r) => r.ok), // [] (nothing stale) → true
      files: c?.files ?? [],
      diffs: results.map((r) => r.diff),
    };
  },
});

// ── Plan helpers ──────────────────────────────────────────────

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function tail(s: string, max: number): string {
  return s.length > max ? `…${s.slice(-max)}` : s;
}

/** The failing tests as text for the worker's prompt, trimmed to `max` chars. */
function formatFailures(failing: TestFailure[], max: number): string {
  const blocks = failing.map((f) => `${f.file} › ${f.name}\n${f.message}`.trim());
  const text = blocks.join("\n\n");
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}
