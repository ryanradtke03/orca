import type { Gate, Task } from "../types.js";

/** One failing test, as a parser pulls it out of a test runner's JSON report. */
export interface ParsedFailure {
  name: string; // the test's full title, used to compare the failing set across runs
  message: string; // the first failure message, used to tell an assertion from a crash
}

/**
 * Error names and markers that mean "the test blew up" rather than "an assertion
 * was violated". A repro test must fail because the code gives the wrong answer,
 * not because it threw a `TypeError` or timed out — otherwise fix-ci would go on
 * to "fix" a crash nobody reported. Matched against each failure's message.
 */
const NOT_AN_ASSERTION = [
  /\bTypeError\b/,
  /\bReferenceError\b/,
  /\bRangeError\b/,
  /\bSyntaxError\b/,
  /\bEvalError\b/,
  /\bURIError\b/,
  /\bUnhandledRejection\b/,
  /timed out\b/i,
  /Cannot find (?:module|package)\b/,
  /failed to (?:load|resolve)\b/i,
];

/**
 * Reject the attempt unless the test command fails the *right* way: every failing
 * test failed on an assertion, and the same set of tests fails twice in a row.
 *
 * It's gate 5 of repro-bug, and the one that makes "the test fails" mean something.
 * Without it a `TypeError` from `median(undefined)` counts as a reproduction, and a
 * flaky timeout looks like a caught bug. The command is run with a JSON reporter so
 * `parse` can see each failure's error; append the reporter flag in `command`
 * (e.g. `pnpm vitest run file --reporter=json`).
 *
 * `parse` is injected so the engine stays runner-agnostic — the recipe passes a
 * Vitest/Jest parser, mirroring how `commandPasses` takes its command from the task.
 * A parser that throws (no JSON found, i.e. the suite crashed before collecting)
 * fails the gate via runGates' catch, which is the correct verdict here.
 */
export function failsWithAssertion(
  command: string | ((task: Task) => string),
  parse: (output: string) => ParsedFailure[],
  opts: { timeoutMs?: number; runs?: number } = {},
): Gate {
  const runs = Math.max(2, opts.runs ?? 2); // at least twice, to catch flakiness

  return {
    name: "failsWithAssertion",
    async check(ctx) {
      const cmd = typeof command === "function" ? command(ctx.task) : command;

      const sets: string[][] = [];
      for (let i = 0; i < runs; i++) {
        const { stdout, stderr } = await ctx.exec(cmd, { timeoutMs: opts.timeoutMs });
        const failures = parse(`${stdout}${stderr}`);

        if (failures.length === 0) {
          return fail(
            `\`${cmd}\` reported no failing tests, so nothing was reproduced ` +
              "(a non-zero exit with no test failures usually means the suite crashed)",
          );
        }

        const crashes = failures.filter((f) => isCrash(f.message));
        if (crashes.length > 0) {
          return fail(
            ...crashes.map(
              (f) =>
                `"${f.name}" failed with an error, not an assertion — ` +
                "fix the test to check the value the bug produces:\n" +
                firstLine(f.message),
            ),
          );
        }

        sets.push(failures.map((f) => f.name).sort());
      }

      const [first, ...rest] = sets;
      const flaky = rest.find((s) => !sameSet(first ?? [], s));
      if (flaky) {
        return fail(
          "the failing tests differ between runs, so the repro is flaky — " +
            `run 1 failed [${(first ?? []).join(", ")}], a later run failed [${flaky.join(", ")}]`,
        );
      }

      return { ok: true };
    },
  };
}

function isCrash(message: string): boolean {
  return NOT_AN_ASSERTION.some((rx) => rx.test(message));
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

function firstLine(message: string): string {
  return (message.split("\n").find((l) => l.trim() !== "") ?? message).trim();
}

function fail(...reasons: string[]) {
  return { ok: false as const, reasons };
}
