// Parse Vitest's JSON reporter (`vitest run --reporter=json`). Vitest mirrors
// Jest's JSON shape: one object on stdout with a `testResults` array, one entry
// per test file, each holding `assertionResults` (the individual tests).
//
//   { testResults: [ { name, assertionResults: [ { title, status, failureMessages } ] } ] }
//
// A file's `name` is an absolute path; `parseVitestJson` relativizes it against
// `cwd` so the files match the engine's repo-relative `changedFiles`.
//
// Shared because add-tests (Phase 2) reuses the same parser to find which files
// still have failing tests.

import path from "node:path";

export interface TestFailure {
  file: string; // repo-relative path of the test file
  name: string; // the test's full title
  message: string; // the first failure message
}

interface VitestAssertion {
  title?: string;
  fullName?: string;
  ancestorTitles?: string[];
  status?: string;
  failureMessages?: string[];
}
interface VitestFileResult {
  name?: string; // absolute path to the test file
  assertionResults?: VitestAssertion[];
}
interface VitestReport {
  testResults?: VitestFileResult[];
}

/**
 * Parse Vitest's JSON reporter output into a flat list of failing tests.
 *
 * `output` is the command's combined stdout+stderr: a `pnpm`/`npm` wrapper adds
 * its own lines around the JSON (e.g. an `ELIFECYCLE` notice when the test
 * command exits non-zero), so we locate the JSON object rather than parsing the
 * whole string. Throws if no object with a `testResults` array is found — plan()
 * turns that into a `plan_failed` before any tokens are spent.
 */
export function parseVitestJson(output: string, cwd = process.cwd()): TestFailure[] {
  const report = extractReport(output);

  const failures: TestFailure[] = [];
  for (const file of report.testResults ?? []) {
    const rel = filePath(file.name, cwd);
    for (const a of file.assertionResults ?? []) {
      if (a.status !== "failed") continue;
      failures.push({
        file: rel,
        name: testName(a),
        message: (a.failureMessages ?? [])[0] ?? "",
      });
    }
  }
  return failures;
}

function extractReport(output: string): VitestReport {
  for (const candidate of jsonCandidates(output)) {
    const parsed = tryParse(candidate);
    if (hasTestResults(parsed)) return parsed;
  }
  throw new Error(
    "could not parse Vitest JSON output: expected an object with a `testResults` array. " +
      "Does the test command support `--reporter=json`?",
  );
}

function hasTestResults(parsed: unknown): parsed is VitestReport {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as VitestReport).testResults)
  );
}

/**
 * Strings to try parsing, in priority order. The whole output comes first, then
 * each line — Vitest's JSON reporter prints the report as one line, so this skips
 * any wrapper noise around it (a `pnpm` install/lockfile preamble on a worktree's
 * first command, an "update available" box, an ELIFECYCLE footer). The outermost
 * `{ … }` slice is the last resort, for a report pretty-printed across lines.
 */
function jsonCandidates(output: string): string[] {
  const candidates = [output.trim()];
  for (const line of output.split("\n")) {
    const t = line.trim();
    if (t.startsWith("{") && t.includes("testResults")) candidates.push(t);
  }
  const sliced = sliceJsonObject(output);
  if (sliced) candidates.push(sliced);
  return candidates;
}

function tryParse(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** The outermost `{ ... }` in a string, or null — enough to skip wrapper noise. */
function sliceJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start !== -1 && end > start ? s.slice(start, end + 1) : null;
}

function filePath(name: string | undefined, cwd: string): string {
  if (!name) return "";
  return path.isAbsolute(name) ? path.relative(cwd, name) : name;
}

/** Prefer the full name (ancestors + title); fall back to whatever is present. */
function testName(a: VitestAssertion): string {
  if (a.fullName) return a.fullName;
  const ancestors = a.ancestorTitles ?? [];
  const parts = [...ancestors, a.title].filter((p): p is string => Boolean(p));
  return parts.join(" > ") || (a.title ?? "unknown test");
}
