// Parse a unified diff (as produced by `git diff base...head`) into the new-side
// line ranges of each file's hunks. pr-review hands the result to the engine's
// anchoredInDiff gate so a review can only comment on lines the change touched.

/** Shorten long text for a prompt, marking where it was cut. */
export function trim(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…(truncated)` : s;
}

/**
 * The paths a unified diff touches, read from its `diff --git a/<path> b/<path>`
 * headers. Unlike `parseHunks`, this keeps renamed and deleted files too, since
 * pr-describe wants the full list of what changed, not only lines to comment on.
 */
export function changedFiles(diff: string): string[] {
  return [...diff.matchAll(/^diff --git a\/(.+?) b\//gm)].map((m) => m[1] ?? "");
}

/**
 * Map each changed file to the new-side line ranges of its diff hunks, e.g.
 * `{ "src/stats.ts": [[10, 14], [40, 41]] }`. The range is the span the hunk
 * header reports on the new side (`@@ -a,b +c,d @@` → `[c, c + d - 1]`), so it
 * covers the added/changed lines plus their surrounding context.
 *
 * Deleted files (`+++ /dev/null`) contribute no ranges — there are no new lines
 * on which to comment. A hunk with a zero new-side length (a pure deletion) is
 * skipped for the same reason.
 */
export function parseHunks(diff: string): Record<string, [number, number][]> {
  const ranges: Record<string, [number, number][]> = {};
  let file: string | null = null;

  for (const line of diff.split("\n")) {
    const newFile = line.match(/^\+\+\+ (.+)$/);
    if (newFile) {
      const target = newFile[1]?.trim();
      // Strip the `b/` prefix git adds; /dev/null means the file was deleted.
      file = target && target !== "/dev/null" ? target.replace(/^b\//, "") : null;
      continue;
    }

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk && file) {
      const start = Number(hunk[1]);
      const len = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (len > 0) {
        const list = ranges[file] ?? [];
        list.push([start, start + len - 1]);
        ranges[file] = list;
      }
    }
  }

  return ranges;
}
