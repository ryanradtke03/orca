import type { Gate } from "../types.js";

// Minimal glob → RegExp: `*` matches within a path segment, `**` matches across
// segments, `?` matches one non-slash char. Enough for allow-lists like
// "src/**", "*.ts", "packages/app/**/*.tsx".
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // swallow the slash after ** so "src/**" matches "src/a"
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c && ".+^(){}[]$|\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Reject the attempt if it changed any file outside the allowed globs.
 * Enforces a recipe's `allowEdits` after the fact, from the diff.
 */
export function onlyTouches(globs: string[]): Gate {
  const matchers = globs.map(globToRegExp);
  return {
    name: "onlyTouches",
    async check(ctx) {
      const offending = ctx.changedFiles.filter((file) => !matchers.some((m) => m.test(file)));
      if (offending.length === 0) return { ok: true };
      return {
        ok: false,
        reasons: offending.map((f) => `changed a file outside the allowed paths: ${f}`),
      };
    },
  };
}
