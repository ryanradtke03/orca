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

// Copy a pattern without the global flag so repeated .test() calls aren't stateful.
function stateless(pattern: RegExp): RegExp {
  return pattern.global ? new RegExp(pattern.source, pattern.flags.replace("g", "")) : pattern;
}

/**
 * Reject the attempt if it changed any file whose path matches one of the
 * patterns — a deny-list on file names (matched against the changed paths, not
 * their contents). The complement of onlyTouches: use it to protect tests,
 * config, lockfiles, etc. from being edited to force a command green.
 */
export function noFileChanges(patterns: RegExp[]): Gate {
  const matchers = patterns.map(stateless);
  return {
    name: "noFileChanges",
    async check(ctx) {
      const offending = ctx.changedFiles.filter((file) => matchers.some((m) => m.test(file)));
      if (offending.length === 0) return { ok: true };
      return {
        ok: false,
        reasons: offending.map((f) => `changed a protected file: ${f}`),
      };
    },
  };
}
