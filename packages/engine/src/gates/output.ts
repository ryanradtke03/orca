import { extractJson } from "@orchestra/messenger";
import type { z } from "zod";
import type { Gate, Task } from "../types.js";

/** A readable list of what was wrong, to send back to the worker as feedback. */
function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
}

/**
 * Reject the attempt unless the worker's final message parses as JSON and matches
 * `schema`. The gate for read-only recipes: there's no diff to check, so the
 * worker's structured output is the work, and this is the same validation
 * `askJson` does — JSON out of the reply, then Zod — surfaced as a gate so a bad
 * shape becomes retry feedback instead of a thrown error.
 *
 * Blocks free-text reviews, invented fields and, via a schema `.refine`, rules
 * like "request_changes iff there's a blocking comment".
 */
export function outputMatches(schema: z.ZodType): Gate {
  return {
    name: "outputMatches",
    async check(ctx) {
      const value = extractJson(ctx.output);
      if (value === undefined) {
        return { ok: false, reasons: ["the final message was not valid JSON"] };
      }
      const parsed = schema.safeParse(value);
      return parsed.success ? { ok: true } : { ok: false, reasons: describeIssues(parsed.error) };
    },
  };
}

/** A comment the worker made, once its output has parsed as JSON. */
interface AnchoredComment {
  file?: unknown;
  line?: unknown;
}

/**
 * Reject the attempt unless every comment in the worker's output points at a line
 * the diff actually changed. `hunks(task)` maps each changed file to the new-side
 * line ranges of its diff hunks (see `parseHunks`); a comment passes when its line
 * falls inside one of its file's ranges, with a few lines of slack so a comment
 * on the line just above or below a change still counts.
 *
 * Blocks comments about code the change didn't touch and invented line numbers —
 * the two ways a review looks grounded without being grounded. It fails closed
 * unless the output is a JSON object (so it's safe on its own, not only when
 * `outputMatches` runs first), and treats a comment with no usable file/line as
 * unanchored rather than trusted.
 */
export function anchoredInDiff(
  hunks: (task: Task) => Record<string, [number, number][]>,
  opts: { slack?: number } = {},
): Gate {
  const slack = opts.slack ?? 2;
  return {
    name: "anchoredInDiff",
    async check(ctx) {
      const parsed = extractJson(ctx.output);
      // Fail closed unless the output is a JSON object. extractJson returns
      // undefined for non-JSON and null for the literal `null`; both, and bare
      // primitives, can't carry comments and would otherwise throw on `.comments`.
      // In pr-review outputMatches rejects these first, but failing here keeps the
      // gate correct if it's reused alone or the gate order ever changes.
      if (parsed === null || typeof parsed !== "object") {
        return { ok: false, reasons: ["the final message was not a JSON object"] };
      }
      const comments = (parsed as { comments?: unknown }).comments;
      if (!Array.isArray(comments)) return { ok: true }; // object with no comments to anchor

      const ranges = hunks(ctx.task);
      const reasons: string[] = [];
      for (const c of comments as AnchoredComment[]) {
        const file = typeof c.file === "string" ? c.file : undefined;
        const line = typeof c.line === "number" ? c.line : undefined;
        if (file === undefined || line === undefined) {
          reasons.push(`a comment is missing a file or line: ${JSON.stringify(c)}`);
          continue;
        }
        const fileRanges = ranges[file];
        if (!fileRanges) {
          reasons.push(`comment on ${file}:${line}, but the diff didn't change ${file}`);
          continue;
        }
        const hit = fileRanges.some(([start, end]) => line >= start - slack && line <= end + slack);
        if (!hit) {
          reasons.push(`comment on ${file}:${line} is not inside a changed hunk`);
        }
      }
      return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
    },
  };
}

/** Does the file `f` the diff changed fall under the path a change entry names? */
function covers(entry: string, f: string): boolean {
  if (entry === f) return true;
  // A grouped entry (a directory) covers every file beneath it, so a 40-file
  // rename can be described as "src/models/ — renamed Foo to Bar".
  if (f.startsWith(`${entry.replace(/\/+$/, "")}/`)) return true;
  // Allow the bare basename, so "stats.ts" matches "src/stats.ts".
  return f.split("/").pop() === entry;
}

interface ChangeEntry {
  file?: unknown;
}

/**
 * Reject the attempt unless the `changes` the worker listed line up with the diff:
 * every file a change entry names is one the diff touched (no invented files), and
 * every changed file is covered by some entry (no silently dropped changes). A
 * change entry may name a directory to group a mechanical change over many files.
 *
 * `files(task)` is the diff's changed paths, computed in plan(). Like
 * `anchoredInDiff`, it fails closed on non-object output and leaves the shape of
 * `changes` to `outputMatches`: a missing or non-array `changes` passes here.
 */
export function mentionsOnlyDiffFiles(files: (task: Task) => string[]): Gate {
  return {
    name: "mentionsOnlyDiffFiles",
    async check(ctx) {
      const parsed = extractJson(ctx.output);
      if (parsed === null || typeof parsed !== "object") {
        return { ok: false, reasons: ["the final message was not a JSON object"] };
      }
      const changes = (parsed as { changes?: unknown }).changes;
      if (!Array.isArray(changes)) return { ok: true }; // shape is outputMatches' job

      const diffFiles = files(ctx.task);
      const named = (changes as ChangeEntry[]).map((c) =>
        typeof c.file === "string" ? c.file : undefined,
      );
      const reasons: string[] = [];

      for (const entry of named) {
        if (entry === undefined) {
          reasons.push("a change entry is missing a file");
        } else if (!diffFiles.some((f) => covers(entry, f))) {
          reasons.push(`changes mention ${entry}, which the diff didn't touch`);
        }
      }
      for (const f of diffFiles) {
        if (!named.some((entry) => entry !== undefined && covers(entry, f))) {
          reasons.push(`${f} changed but no change entry describes it`);
        }
      }
      return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
    },
  };
}

/**
 * Reject the attempt unless the description links the issue it was given: when
 * `issue(task)` is a number, the output's `closes` must equal it. With no issue
 * (the accessor returns undefined) there's nothing to link, so the gate passes.
 * Keeps a chained PR from forgetting its "Fixes #N".
 */
export function closesIssue(issue: (task: Task) => number | undefined): Gate {
  return {
    name: "closesIssue",
    async check(ctx) {
      const number = issue(ctx.task);
      if (number === undefined) return { ok: true }; // no issue to link
      const parsed = extractJson(ctx.output);
      if (parsed === null || typeof parsed !== "object") {
        return { ok: false, reasons: ["the final message was not a JSON object"] };
      }
      const closes = (parsed as { closes?: unknown }).closes;
      return closes === number
        ? { ok: true }
        : {
            ok: false,
            reasons: [
              `issue #${number} was given, but \`closes\` is ${JSON.stringify(closes ?? null)}`,
            ],
          };
    },
  };
}

/** A run that fed into this branch: which recipe, and the gates it passed. */
export interface Evidence {
  recipe: string;
  ok: boolean;
  gatesPassed: string[];
  summary?: string | undefined;
}

interface TestingClaim {
  claim?: unknown;
  evidence?: unknown;
}

/**
 * Reject the attempt unless every `testing` claim cites something that really ran:
 * each entry's `evidence` string must name a recipe or a passed gate from the run
 * evidence. With no evidence at all, `testing` must be empty — a PR opened by hand,
 * with nothing verified, may not claim any testing.
 *
 * This is the gate that keeps an AI description honest: "added tests", "verified
 * locally" and "all tests pass" don't survive unless a gate actually passed. Fails
 * closed on non-object output; a missing `testing` section passes (outputMatches
 * owns the shape).
 */
export function claimsMatchEvidence(evidence: (task: Task) => Evidence[]): Gate {
  return {
    name: "claimsMatchEvidence",
    async check(ctx) {
      const parsed = extractJson(ctx.output);
      if (parsed === null || typeof parsed !== "object") {
        return { ok: false, reasons: ["the final message was not a JSON object"] };
      }
      const testing = (parsed as { testing?: unknown }).testing;
      if (testing === undefined) return { ok: true }; // shape is outputMatches' job
      if (!Array.isArray(testing)) {
        return { ok: false, reasons: ["`testing` must be an array"] };
      }

      const known = evidence(ctx.task).flatMap((e) => [e.recipe, ...e.gatesPassed]);
      if (known.length === 0) {
        return testing.length === 0
          ? { ok: true }
          : {
              ok: false,
              reasons: [
                "no run evidence was provided, so `testing` must be empty — don't claim tests were run",
              ],
            };
      }

      const reasons: string[] = [];
      for (const c of testing as TestingClaim[]) {
        const cite = typeof c.evidence === "string" ? c.evidence : undefined;
        if (cite === undefined || !known.some((k) => cite.includes(k))) {
          reasons.push(
            `testing claim ${JSON.stringify(c.claim ?? null)} cites ${JSON.stringify(
              cite ?? null,
            )}, which isn't in the run evidence`,
          );
        }
      }
      return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
    },
  };
}
