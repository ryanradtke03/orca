import { describe, expect, it } from "vitest";
import { parseVitestJson } from "../src/shared/vitest.js";

// A trimmed sample of what `vitest run --reporter=json` writes: one file with a
// passing and a failing assertion. Absolute `name`, as Vitest emits.
const report = {
  numTotalTests: 2,
  numFailedTests: 1,
  testResults: [
    {
      name: "/repo/test/money.test.ts",
      status: "failed",
      assertionResults: [
        {
          ancestorTitles: ["formatCents"],
          title: "formats whole dollars",
          fullName: "formatCents > formats whole dollars",
          status: "passed",
          failureMessages: [],
        },
        {
          ancestorTitles: ["formatCents"],
          title: "includes the currency code",
          fullName: "formatCents > includes the currency code",
          status: "failed",
          failureMessages: ["expected '$19.99' to be 'USD 19.99'"],
        },
      ],
    },
  ],
};

describe("parseVitestJson", () => {
  it("returns only the failing tests, with repo-relative files", () => {
    const failures = parseVitestJson(JSON.stringify(report), "/repo");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({
      file: "test/money.test.ts",
      name: "formatCents > includes the currency code",
      message: "expected '$19.99' to be 'USD 19.99'",
    });
  });

  it("returns [] when every test passes", () => {
    const allPass = {
      testResults: [
        { name: "/repo/test/a.test.ts", assertionResults: [{ title: "ok", status: "passed" }] },
      ],
    };
    expect(parseVitestJson(JSON.stringify(allPass), "/repo")).toEqual([]);
  });

  it("finds the JSON even with pnpm wrapper noise around it", () => {
    const noisy = `\n> playground@ test\n> vitest run --reporter=json\n\n${JSON.stringify(report)}\n ELIFECYCLE  Command failed with exit code 1.\n`;
    const failures = parseVitestJson(noisy, "/repo");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.file).toBe("test/money.test.ts");
  });

  it("finds the JSON when the preamble itself contains braces", () => {
    // A worktree's first `pnpm` command prints an install/update preamble to
    // stdout before Vitest's JSON; some of those lines carry braces, which
    // defeated a naive first-`{`…last-`}` slice.
    const noisy = `Progress: resolved 54, reused 54\n{ update available: 12.9.1 }\nDone in 569ms\n${JSON.stringify(
      report,
    )}\n`;
    const failures = parseVitestJson(noisy, "/repo");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.file).toBe("test/money.test.ts");
  });

  it("throws when there is no testResults array", () => {
    expect(() => parseVitestJson("no json here")).toThrow(/Vitest JSON/);
  });
});
