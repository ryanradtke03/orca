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
 * the two ways a review looks grounded without being grounded. Runs after
 * `outputMatches`, so by here the output is known to parse; a comment with no
 * usable file/line is treated as unanchored rather than trusted.
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
      const comments = (parsed as { comments?: unknown })?.comments;
      if (!Array.isArray(comments)) return { ok: true }; // no comments to anchor

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
