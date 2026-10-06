import { randomUUID } from "node:crypto";
import {
  commandFails,
  commandPasses,
  defineRecipe,
  failsWithAssertion,
  noPattern,
  onlyTouches,
} from "@orchestra/engine";
import { z } from "zod";
import { parseVitestJson } from "../shared/vitest.js";

// Ways to fake a failing test without actually checking the reported behavior:
// type-suppressions, skipped/todo tests, a hard-thrown error, or a tautology that
// fails no matter what the code does. Checked on added lines only.
const CHEATS = [
  /@ts-ignore/,
  /@ts-expect-error/,
  /@ts-nocheck/,
  /\.(skip|only|todo|fails)\(/,
  /\bas any\b/,
  /expect\(true\)/,
  /expect\(false\)/,
  /\bthrow new [A-Za-z]*Error/,
];

const TYPECHECK = "pnpm typecheck";

interface ReproContext extends Record<string, unknown> {
  report: string;
  reproFile: string;
  command: string; // the test command scoped to the repro file; handed to fix-ci
  example: string; // a test file to copy the style of, or "" if none found
}

const ctxOf = (context: Record<string, unknown>) => context as ReproContext;

export const reproBug = defineRecipe({
  name: "repro-bug",
  description:
    "Turn a bug report into one test that fails on the current code for the reason the report describes, without fixing the bug",
  input: z.object({
    report: z.string().min(10), // title + body
    issue: z.number().int().optional(), // used in the file name
    test: z.string().default("pnpm vitest run"), // must support --reporter=json
    dir: z.string().default("test/repro"),
  }),

  async plan(input, ctx) {
    const name = input.issue ? `issue-${input.issue}` : randomUUID().slice(0, 8);
    const reproFile = `${input.dir}/${name}.test.ts`;
    const context: ReproContext = {
      report: trim(input.report, 4000),
      reproFile,
      command: `${input.test} ${reproFile}`,
      example: await pickExampleTest(ctx, reproFile),
    };
    return [
      {
        id: "repro",
        goal: "Write one test file that fails because of the reported bug",
        dependsOn: [],
        context,
      },
    ];
  },

  worker: (task) => {
    const c = ctxOf(task.context);
    return {
      prompt: [
        `A user reported a bug:\n"""\n${c.report}\n"""`,
        `Find the code involved and write a test in ${c.reproFile} that checks the` +
          " CORRECT behavior described in the report. It must fail on the current code" +
          " because of this bug, and pass once the bug is fixed.",
        "Keep it small: the fewest tests that show the bug. Import from the real source," +
          " and assert on the value the code returns — don't make the test throw on its own.",
        `Don't edit any other file. If the code already behaves correctly, or the report is` +
          " too vague to turn into a test, stop and start your final message with" +
          " CANNOT_REPRODUCE: and the reason.",
        c.example ? `Match the style of ${c.example}.` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      tools: ["Read", "Grep", "Glob", "Write", "Edit", "Bash(pnpm vitest:*)", "Bash(pnpm test:*)"],
      maxTurns: 25,
    };
  },

  gates: [
    // cheap: only the one repro file may be created or changed — not the source
    // (that's fix-ci's job) and not other tests.
    onlyTouches((task) => [ctxOf(task.context).reproFile]),
    // cheap: no suppressions, skips, hand-thrown failures or tautologies.
    noPattern(CHEATS),
    // medium: the repro file type-checks, so a "failure" isn't just a bad import.
    commandPasses(TYPECHECK),
    // medium: the test actually fails, so it shows the bug.
    commandFails((task) => ctxOf(task.context).command),
    // medium: it fails on an assertion (not a crash) and fails the same way twice.
    // `--outputFile=/dev/stdout` forces the JSON report onto stdout: piped (non-TTY)
    // Vitest otherwise writes it to .vitest/json/output.json and prints only a notice.
    failsWithAssertion(
      (task) => `${ctxOf(task.context).command} --reporter=json --outputFile=/dev/stdout`,
      (output) => parseVitestJson(output),
    ),
  ],

  async finish(results) {
    const task = results[0];
    const c = task ? ctxOf(task.task.context) : null;
    const reproduced = results.every((r) => r.ok) && results.length > 0;
    return {
      reproduced,
      reproFile: c?.reproFile,
      command: c?.command,
      // Without engine-level task output (Composition phase) the worker's
      // CANNOT_REPRODUCE message isn't captured here, so fall back to the gate
      // reasons from the final attempt.
      reason: reproduced ? undefined : (task?.failures ?? []).join("\n") || undefined,
    };
  },
});

// ── Plan helpers ──────────────────────────────────────────────

function trim(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…(truncated)` : s;
}

/**
 * A committed test file for the worker to copy the house style from. Prefers one
 * outside the repro dir (a real example), and never the file we're about to write.
 * Returns "" when the repo has no tests yet — the prompt then drops that line.
 */
async function pickExampleTest(
  ctx: { exec(cmd: string): Promise<{ code: number; output: string }> },
  reproFile: string,
): Promise<string> {
  const listed = await ctx.exec('git ls-files "*.test.ts" "*.test.tsx"');
  if (listed.code !== 0) return "";
  const files = listed.output
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  return files.find((f) => f !== reproFile) ?? "";
}
