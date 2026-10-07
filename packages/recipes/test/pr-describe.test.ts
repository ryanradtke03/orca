import { describe, expect, it } from "vitest";
import { type PrDescription, PrDescriptionSchema, render } from "../src/pr-describe/index.js";

const base: PrDescription = {
  title: "Fix median for even-length inputs",
  summary: "median([1,2,3,4]) returned 3; it now averages the two middle values.",
  changes: [{ file: "src/stats.ts", what: "average the two middle elements" }],
  testing: [{ claim: "the repro test now passes", evidence: "commandPasses: pnpm check" }],
  risks: [],
  closes: 42,
};

describe("render", () => {
  it("opens with a Fixes line when the PR closes an issue", () => {
    expect(render(base).startsWith("Fixes #42")).toBe(true);
  });

  it("omits the Fixes line when there's no issue", () => {
    const { closes, ...rest } = base;
    expect(render(rest as PrDescription)).not.toContain("Fixes #");
  });

  it("lists each change as a bullet with the file in code", () => {
    expect(render(base)).toContain("- `src/stats.ts` — average the two middle elements");
  });

  it("renders testing claims with their evidence", () => {
    expect(render(base)).toContain("- the repro test now passes (commandPasses: pnpm check)");
  });

  it("says plainly when no testing was run", () => {
    expect(render({ ...base, testing: [] })).toContain("No automated checks were run");
  });

  it("includes a Risks section only when there are risks", () => {
    expect(render(base)).not.toContain("## Risks");
    expect(render({ ...base, risks: ["touches the shared cart total"] })).toContain(
      "## Risks\n- touches the shared cart total",
    );
  });

  it("does not repeat the title in the body (the PR's own field)", () => {
    expect(render(base)).not.toContain(base.title);
  });
});

describe("PrDescriptionSchema", () => {
  it("rejects a title longer than 72 characters", () => {
    expect(PrDescriptionSchema.safeParse({ ...base, title: "x".repeat(73) }).success).toBe(false);
  });

  it("rejects more than 20 change entries", () => {
    const changes = Array.from({ length: 21 }, (_, i) => ({ file: `src/f${i}.ts`, what: "x" }));
    expect(PrDescriptionSchema.safeParse({ ...base, changes }).success).toBe(false);
  });
});
