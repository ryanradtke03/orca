// Parse Biome's JSON reporter (`biome lint --reporter=json`). Biome is the one
// linter fix-lint supports today; ESLint's `--format json` would get its own
// parser alongside this one (see the recipe's open questions).
//
// The reporter writes one JSON object to stdout:
//   { summary: {...}, diagnostics: [ { severity, message, category, location } ], command }
// A diagnostic's `location.path` is relative to the cwd Biome ran in when the
// path argument was relative, or absolute when it wasn't; `parseLintJson`
// relativizes absolute paths against `cwd` so the files match the engine's
// repo-relative `changedFiles`.

import path from "node:path";

export interface LintError {
  file: string; // repo-relative
  rule: string; // the rule name, e.g. "noExplicitAny" (the last segment of the category)
  line: number;
  message: string;
  severity: "error" | "warning" | "information";
}

interface BiomeLocation {
  path?: string | { file?: string };
  start?: { line?: number; column?: number };
}
interface BiomeDiagnostic {
  severity?: string;
  message?: unknown; // a string in current Biome; older versions used markup nodes
  category?: string;
  location?: BiomeLocation;
}
interface BiomeReport {
  diagnostics?: BiomeDiagnostic[];
}

/**
 * Parse Biome's JSON reporter output into a flat list of lint errors.
 *
 * `output` is the command's combined stdout+stderr: a `pnpm`/`npm` wrapper may
 * add its own lines around the JSON (e.g. an `ELIFECYCLE` notice when the lint
 * command exits non-zero), so we locate the JSON object rather than parsing the
 * whole string. Throws if no JSON object with a `diagnostics` array is found —
 * plan() turns that into a `plan_failed` before any tokens are spent.
 */
export function parseLintJson(output: string, cwd = process.cwd()): LintError[] {
  const report = extractReport(output);

  const errors: LintError[] = [];
  for (const d of report.diagnostics ?? []) {
    const file = locationPath(d.location, cwd);
    if (!file) continue; // a diagnostic with no file location isn't actionable here
    errors.push({
      file,
      rule: ruleName(d.category),
      line: d.location?.start?.line ?? 0,
      message: messageText(d.message),
      severity: severityOf(d.severity),
    });
  }
  return errors;
}

function extractReport(output: string): BiomeReport {
  const parsed = tryParse(output.trim()) ?? tryParse(sliceJsonObject(output));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as BiomeReport).diagnostics)
  ) {
    throw new Error(
      "could not parse Biome JSON output: expected an object with a `diagnostics` array. " +
        "Does the lint command support `--reporter=json`?",
    );
  }
  return parsed as BiomeReport;
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

function locationPath(loc: BiomeLocation | undefined, cwd: string): string | null {
  const raw = typeof loc?.path === "string" ? loc.path : loc?.path?.file;
  if (!raw) return null;
  return path.isAbsolute(raw) ? path.relative(cwd, raw) : raw;
}

/** "lint/suspicious/noExplicitAny" → "noExplicitAny"; leaves plain names as-is. */
function ruleName(category: string | undefined): string {
  if (!category) return "unknown";
  const last = category.split("/").pop();
  return last && last.length > 0 ? last : category;
}

function severityOf(s: string | undefined): LintError["severity"] {
  return s === "error" || s === "information" ? s : "warning";
}

/** Biome 2.x gives a plain string; tolerate older markup-array shapes too. */
function messageText(message: unknown): string {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    return message
      .map((part) =>
        typeof part === "string" ? part : ((part as { content?: string })?.content ?? ""),
      )
      .join("")
      .trim();
  }
  return "";
}
