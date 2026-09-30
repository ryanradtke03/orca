import type { Gate } from "../types.js";

/**
 * Reject the attempt if any added diff line matches one of the patterns.
 * Only added lines are checked (lines starting with "+", excluding the "+++"
 * file header), so an old `eslint-disable` already in the file doesn't fail it —
 * only ones this attempt introduced.
 */
export function noPattern(patterns: RegExp[]): Gate {
  return {
    name: "noPattern",
    async check(ctx) {
      const added = ctx.diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"));

      const reasons: string[] = [];
      for (const line of added) {
        const content = line.slice(1);
        for (const pattern of patterns) {
          // Copy without the global flag so repeated .test() calls aren't stateful.
          const rx = pattern.global
            ? new RegExp(pattern.source, pattern.flags.replace("g", ""))
            : pattern;
          if (rx.test(content)) {
            reasons.push(`added line matches disallowed pattern ${pattern}: ${content.trim()}`);
          }
        }
      }

      return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
    },
  };
}
