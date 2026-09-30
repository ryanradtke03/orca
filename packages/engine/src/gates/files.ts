import { existsSync } from "node:fs";
import path from "node:path";
import type { Gate } from "../types.js";

/** Reject the attempt unless every listed path exists in the worktree. */
export function filesExist(paths: string[]): Gate {
  return {
    name: "filesExist",
    async check(ctx) {
      const missing = paths.filter((p) => !existsSync(path.join(ctx.worktree, p)));
      if (missing.length === 0) return { ok: true };
      return {
        ok: false,
        reasons: missing.map((p) => `expected file does not exist: ${p}`),
      };
    },
  };
}
