import { describe, expect, it } from "vitest";
import { parseHunks, trim } from "../src/shared/diff.js";

// A two-file unified diff as `git diff base...head` produces it: one hunk in
// stats.ts (new-side lines 10–13) and two in cart.ts (40 and 55–56).
const DIFF = `diff --git a/src/stats.ts b/src/stats.ts
index 1111111..2222222 100644
--- a/src/stats.ts
+++ b/src/stats.ts
@@ -10,3 +10,4 @@ export function median(xs: number[]) {
   const sorted = [...xs].sort((a, b) => a - b);
   const mid = Math.floor(sorted.length / 2);
+  if (sorted.length === 4) return 2.5;
   return sorted[mid];
diff --git a/src/cart.ts b/src/cart.ts
index 3333333..4444444 100644
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -40 +40 @@ export class Cart {
-    return Math.floor(total);
+    return Math.round(total);
@@ -55,1 +55,2 @@ export class Cart {
+    this.items = [];
`;

describe("parseHunks", () => {
  it("maps each file to its new-side hunk ranges", () => {
    expect(parseHunks(DIFF)).toEqual({
      "src/stats.ts": [[10, 13]],
      "src/cart.ts": [
        [40, 40],
        [55, 56],
      ],
    });
  });

  it("defaults a hunk with no new-side length to a single line", () => {
    const diff = `--- a/src/a.ts\n+++ b/src/a.ts\n@@ -3 +7 @@\n-old\n+new\n`;
    expect(parseHunks(diff)).toEqual({ "src/a.ts": [[7, 7]] });
  });

  it("ignores deleted files, which have no new-side lines", () => {
    const diff = `--- a/src/gone.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n`;
    expect(parseHunks(diff)).toEqual({});
  });

  it("returns nothing for an empty diff", () => {
    expect(parseHunks("")).toEqual({});
  });
});

describe("trim", () => {
  it("leaves short text untouched", () => {
    expect(trim("hello", 100)).toBe("hello");
  });

  it("cuts long text and marks the cut", () => {
    const out = trim("x".repeat(50), 10);
    expect(out.startsWith("x".repeat(10))).toBe(true);
    expect(out).toContain("(truncated)");
  });
});
