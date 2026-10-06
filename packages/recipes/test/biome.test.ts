import { describe, expect, it } from "vitest";
import { parseLintJson } from "../src/fix-lint/biome.js";

// Recorded from `biome lint --reporter=json` (Biome 2.5.14): two diagnostics,
// `location.path` relative to the cwd, `message` a plain string, the rule in the
// last segment of `category`. Trimmed to the fields parseLintJson reads.
const RECORDED = JSON.stringify({
  summary: { errors: 1, warnings: 1 },
  diagnostics: [
    {
      severity: "error",
      message: "Unexpected any. Specify a different type.",
      category: "lint/suspicious/noExplicitAny",
      location: { path: "src/money.ts", start: { line: 1, column: 22 } },
    },
    {
      severity: "warning",
      message: "This let declares a variable that is only assigned once.",
      category: "lint/style/useConst",
      location: { path: "src/cart.ts", start: { line: 2, column: 3 } },
    },
  ],
  command: "lint",
});

describe("parseLintJson", () => {
  it("parses file, rule, line, message and severity", () => {
    const errors = parseLintJson(RECORDED);
    expect(errors).toEqual([
      {
        file: "src/money.ts",
        rule: "noExplicitAny",
        line: 1,
        message: "Unexpected any. Specify a different type.",
        severity: "error",
      },
      {
        file: "src/cart.ts",
        rule: "useConst",
        line: 2,
        message: "This let declares a variable that is only assigned once.",
        severity: "warning",
      },
    ]);
  });

  it("relativizes absolute paths against the cwd", () => {
    const json = JSON.stringify({
      diagnostics: [
        {
          severity: "error",
          message: "boom",
          category: "lint/suspicious/noExplicitAny",
          location: { path: "/repo/src/a.ts", start: { line: 3 } },
        },
      ],
    });
    expect(parseLintJson(json, "/repo")[0]?.file).toBe("src/a.ts");
  });

  it("finds the JSON even with wrapper noise around it", () => {
    const noisy = `> orca-playground@ lint\n> biome lint\n${RECORDED}\n ELIFECYCLE  Command failed with exit code 1.`;
    expect(parseLintJson(noisy)).toHaveLength(2);
  });

  it("throws when there's no diagnostics array", () => {
    expect(() => parseLintJson("not json at all")).toThrow(/reporter=json/);
  });
});
