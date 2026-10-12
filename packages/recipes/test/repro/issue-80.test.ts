// Repro for issue #80: pr-describe can't produce a valid description for a large,
// many-file PR. Its own gates fight each other as the file count grows —
// mentionsOnlyDiffFiles wants every changed file covered, while outputMatches caps
// each changes[].what at 200 chars and the whole changes array at 20 entries. These
// tests run the recipe's real, wired-up gates against complete, honest descriptions
// of a large diff: coverage is satisfied, yet the output gate rejects them today.
import type { Gate, GateContext, Task } from "@orchestra/engine";
import { describe, expect, it } from "vitest";
import { type PrDescription, prDescribe } from "../../src/pr-describe/index.js";

/** The gate the recipe actually wires up, found by name in its own gate list. */
function gate(name: string): Gate {
  const found = prDescribe.gates.find((g) => g.name === name);
  expect(found, `recipe should wire up the ${name} gate`).toBeDefined();
  return found as Gate;
}

/** Run one of pr-describe's gates against a worker output and the diff's file list. */
function runGate(name: string, output: PrDescription, files: string[]) {
  const task: Task = { id: "describe", goal: "", dependsOn: [], context: { files } };
  const ctx = {
    worktree: "",
    task,
    diff: "",
    changedFiles: files,
    output: JSON.stringify(output),
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  } satisfies GateContext;
  return gate(name).check(ctx);
}

// A valid description in every respect except its `changes` list, which each test sets.
const base: Omit<PrDescription, "changes"> = {
  title: "Add PR description support for large diffs",
  summary: "A large feature PR touches many files; the description must still cover them all.",
  testing: [{ claim: "the suite passes", evidence: "vitest" }],
  risks: [],
};

describe("issue-80: pr-describe on large, many-file diffs", () => {
  it("accepts a grouped entry whose summary of many files runs past 200 chars", async () => {
    // 17 files under one directory, grouped into a single change entry — exactly the
    // grouping the recipe tells the worker to use for a mechanical change over many files.
    const files = Array.from({ length: 17 }, (_, i) => `packages/engine/src/pr/file${i}.ts`);
    const what =
      "Mechanical rename of the PR helpers across all 17 modules in this directory: " +
      "every openPr call site now threads the base branch through, updates its imports, " +
      "and adjusts the local sink fixtures to match the new signature.";
    expect(what.length).toBeGreaterThan(200);
    const output: PrDescription = { ...base, changes: [{ file: "packages/engine/src/pr/", what }] };

    // The directory entry covers every changed file, so coverage is satisfied.
    expect(await runGate("mentionsOnlyDiffFiles", output, files)).toEqual({ ok: true });
    // The grouped summary needs room to describe the group, but the 200-char wall rejects it.
    expect(await runGate("outputMatches", output, files)).toEqual({ ok: true });
  });

  it("covers every file of a >20-file diff within the entry budget", async () => {
    // 23 files, each the sole file under a distinct package — nothing to group, so a
    // complete description needs one entry per file, past the 20-entry cap.
    const files = Array.from({ length: 23 }, (_, i) => `packages/pkg${i}/src/index.ts`);
    const changes = files.map((file) => ({ file, what: "update to match the new API" }));
    const output: PrDescription = { ...base, changes };

    // Every file is covered, one entry each (grouping is impossible here).
    expect(await runGate("mentionsOnlyDiffFiles", output, files)).toEqual({ ok: true });
    // ...yet the 20-entry cap rejects a description that covers all 23 changed files.
    expect(await runGate("outputMatches", output, files)).toEqual({ ok: true });
  });
});
