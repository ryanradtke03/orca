import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorktree, ensureExcluded, getDiff, removeWorktree } from "../src/workspace.js";
import { cleanup, makeScratchRepo, write } from "./helpers.js";

describe("workspace", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo({ "index.ts": "export const x = 1;\n" });
  });
  afterEach(() => cleanup(repo));

  it("creates a worktree on a fresh branch from HEAD", async () => {
    const wt = await createWorktree(repo, "run-1", "task-a", 1);
    expect(wt.branch).toBe("orca/run-1/task-a-1");
    // the seed file is present in the worktree
    const seed = await readFile(path.join(wt.path, "index.ts"), "utf8");
    expect(seed).toContain("export const x = 1");
  });

  it("getDiff stages and reports modified and new files", async () => {
    const wt = await createWorktree(repo, "run-1", "task-a", 1);
    await write(wt.path, "index.ts", "export const x = 2;\n"); // modify
    await write(wt.path, "added.ts", "export const y = 3;\n"); // new

    const diff = await getDiff(wt.path);
    expect(diff.files.sort()).toEqual(["added.ts", "index.ts"]);
    expect(diff.patch).toContain("export const x = 2");
    expect(diff.patch).toContain("export const y = 3");
  });

  it("removeWorktree drops it from git and disk", async () => {
    const wt = await createWorktree(repo, "run-1", "task-a", 1);
    await removeWorktree(repo, wt.path);
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { stdout } = await promisify(execFile)("git", ["worktree", "list"], { cwd: repo });
    expect(stdout).not.toContain(wt.path);
  });

  it("ensureExcluded adds .orchestra/ once", async () => {
    await ensureExcluded(repo);
    await ensureExcluded(repo); // idempotent
    const exclude = await readFile(path.join(repo, ".git", "info", "exclude"), "utf8");
    const occurrences = exclude.split("\n").filter((l) => l.trim() === ".orchestra/").length;
    expect(occurrences).toBe(1);
  });
});
