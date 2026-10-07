import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineChain } from "../src/chain.js";
import { createEngine } from "../src/engine.js";
import { createGitHelpers } from "../src/git.js";
import { localSink } from "../src/pr/local.js";
import { defineRecipe } from "../src/recipe.js";
import type { ChainCtx } from "../src/types.js";
import { createWorktree, getDiff } from "../src/workspace.js";
import { cleanup, drain, makeScratchRepo, runToEnd, scriptedMessenger, write } from "./helpers.js";

const exec = promisify(execFile);
const git = (cwd: string, args: string[]) =>
  exec("git", args, { cwd }).then((r) => r.stdout.trim());

/** A diff that adds `file` with `body`, built via a throwaway worktree + getDiff. */
async function diffAdding(repo: string, file: string, body: string): Promise<string> {
  const wt = await createWorktree(repo, `difftmp-${randomUUID().slice(0, 8)}`, "t", 1);
  await write(wt.path, file, body);
  const { patch } = await getDiff(wt.path);
  const { removeWorktree } = await import("../src/workspace.js");
  await removeWorktree(repo, wt.path);
  return patch;
}

describe("git helpers", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo({ "index.ts": "export const x = 1;\n" });
  });
  afterEach(() => cleanup(repo));

  it("commits a diff onto a new branch without moving HEAD or the checkout", async () => {
    const headBefore = await git(repo, ["rev-parse", "HEAD"]);
    const git_ = createGitHelpers(repo);
    const diff = await diffAdding(repo, "added.ts", "export const y = 2;\n");

    const sha = await git_.commit("orca/bug-1", { diff, message: "test: add y" });

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    // the branch has exactly one new commit over HEAD
    const count = await git(repo, ["rev-list", "--count", `HEAD..orca/bug-1`]);
    expect(count).toBe("1");
    // HEAD and the working checkout never moved
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(await git(repo, ["status", "--porcelain"])).toBe("");
    // the file is on the branch, not on HEAD
    expect(await git(repo, ["show", "orca/bug-1:added.ts"])).toContain("export const y = 2");
    await expect(git(repo, ["cat-file", "-e", "HEAD:added.ts"])).rejects.toBeTruthy();
  });

  it("stacks a second commit on the same branch", async () => {
    const git_ = createGitHelpers(repo);
    await git_.commit("orca/bug-1", {
      diff: await diffAdding(repo, "a.ts", "export const a = 1;\n"),
      message: "first",
    });
    await git_.commit("orca/bug-1", {
      diff: await diffAdding(repo, "b.ts", "export const b = 2;\n"),
      message: "second",
    });
    expect(await git(repo, ["rev-list", "--count", "HEAD..orca/bug-1"])).toBe("2");
  });

  it("refuses to commit to a protected branch", async () => {
    const git_ = createGitHelpers(repo);
    const diff = await diffAdding(repo, "x.ts", "export const x = 9;\n");
    const current = await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]); // main or master
    await expect(git_.commit(current, { diff, message: "nope" })).rejects.toThrow(/protected/);
  });

  it("push refuses a non-orca branch", async () => {
    const git_ = createGitHelpers(repo, { push: () => Promise.resolve() });
    await expect(git_.push("feature/x")).rejects.toThrow(/orca\/\*/);
  });
});

describe("localSink", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "orca-sink-"));
  });
  afterEach(() => cleanup(dir));

  it("reads an issue, opens a PR file, and appends comments", async () => {
    const sink = localSink({ dir });
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.join(dir, "issues"), { recursive: true });
    await writeFile(path.join(dir, "issues", "42.md"), "Median bug\n\nreturns 3 not 2.5\n");

    expect(await sink.readIssue(42)).toBe("Median bug\n\nreturns 3 not 2.5");

    const { url } = await sink.open({
      branch: "orca/bug-42",
      base: "main",
      title: "Fix #42",
      body: "Fixes #42\n\nthe body",
      draft: true,
    });
    expect(url.startsWith("file://")).toBe(true);
    const pr = await readFile(path.join(dir, "prs", "orca", "bug-42.md"), "utf8");
    expect(pr).toContain("# Fix #42");
    expect(pr).toContain("draft: true");
    expect(pr).toContain("Fixes #42");

    await sink.comment(42, "first");
    await sink.comment(42, "second");
    const comments = await readFile(path.join(dir, "comments", "42.md"), "utf8");
    expect(comments).toContain("first");
    expect(comments).toContain("second");
  });

  it("rejects an unknown issue", async () => {
    await expect(localSink({ dir }).readIssue(7)).rejects.toThrow(/not found/);
  });
});

describe("base refs", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo({ "index.ts": "export const x = 1;\n" });
  });
  afterEach(() => cleanup(repo));

  // plan() returns a task only when it can see marker.txt via ctx.exec; the file
  // exists only on the branch, so a task is planned iff the run works at the base.
  const seesMarker = defineRecipe({
    name: "sees-marker",
    description: "",
    input: z.object({}),
    async plan(_input, ctx) {
      const { code } = await ctx.exec("cat marker.txt");
      return code === 0 ? [{ id: "t", goal: "saw marker", dependsOn: [], context: {} }] : [];
    },
    worker: () => ({ prompt: "p", tools: ["Read"], maxTurns: 1 }),
    gates: [],
    async finish(results) {
      return { planned: results.length };
    },
  });

  it("runs plan() and task worktrees at the base branch, not HEAD", async () => {
    // Build a branch that adds marker.txt, without touching the checkout.
    const diff = await diffAdding(repo, "marker.txt", "hello\n");
    await createGitHelpers(repo).commit("orca/feat", { diff, message: "add marker" });

    const engine = createEngine({
      repo,
      messenger: scriptedMessenger(async () => {}),
      recipes: { "sees-marker": seesMarker },
    });

    const atBranch = await runToEnd(engine.start("sees-marker", {}, { base: "orca/feat" }));
    expect(atBranch.result.output).toEqual({ planned: 1 });

    const atHead = await runToEnd(engine.start("sees-marker", {}));
    expect(atHead.result.output).toEqual({ planned: 0 }); // marker not on HEAD
  });
});

describe("child runs & chains", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo({ "index.ts": "export const x = 1;\n" });
  });
  afterEach(() => cleanup(repo));

  const leaf = defineRecipe({
    name: "leaf",
    description: "",
    input: z.object({ tag: z.string() }),
    async plan(input) {
      return [{ id: "t", goal: input.tag, dependsOn: [], context: {} }];
    },
    worker: (task) => ({ prompt: task.goal, tools: ["Edit"], maxTurns: 1 }),
    gates: [],
    async finish(results, _ctx) {
      return { ok: results.every((r) => r.ok) };
    },
  });

  it("runs children in sequence, shares the budget, and emits child.* events", async () => {
    const twice = defineChain({
      name: "twice",
      description: "",
      input: z.object({}),
      async run(_input, ctx: ChainCtx) {
        const a = await ctx.run("leaf", { tag: "a" });
        const b = await ctx.step("second", () => ctx.run("leaf", { tag: "b" }));
        return { both: a.ok && b.ok };
      },
    });

    const engine = createEngine({
      repo,
      messenger: scriptedMessenger((req) => write(req.cwd, "f.txt", "x")),
      recipes: { leaf, twice },
    });

    const { events, result } = await runToEnd(engine.start("twice", {}));
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ both: true });
    // two child runs, each with a start and a done
    const started = events.filter((e) => e.type === "child.started");
    const finished = events.filter((e) => e.type === "child.done");
    expect(started).toHaveLength(2);
    expect(finished).toHaveLength(2);
    // the two leaf workers' cost rolled up into the chain's total
    expect(result.costUsd).toBeCloseTo(0.002, 5);
    // step brackets are emitted
    expect(events.some((e) => e.type === "step.started" && e.name === "second")).toBe(true);
    expect(events.some((e) => e.type === "step.done" && e.name === "second")).toBe(true);
  });

  it("stops a chain at the cost cap and reports partial", async () => {
    const many = defineChain({
      name: "many",
      description: "",
      input: z.object({}),
      async run(_input, ctx: ChainCtx) {
        const results = [];
        for (let i = 0; i < 5; i++) results.push(await ctx.run("leaf", { tag: `t${i}` }));
        return { ran: results.filter((r) => r.ok).length };
      },
    });
    const engine = createEngine({
      repo,
      messenger: scriptedMessenger((req) => write(req.cwd, "f.txt", "x")),
      recipes: { leaf, many },
      limits: { maxCostUsd: 0.0025 }, // ~2 leaf runs at 0.001 each
    });
    const { result } = await runToEnd(engine.start("many", {}));
    // the chain's children stop succeeding once the shared budget is spent
    const output = result.output as { ran: number };
    expect(output.ran).toBeLessThan(5);
  });

  it("caps child recursion at the depth limit", async () => {
    // A chain that keeps starting itself. The deepest allowed child is refused,
    // so it never recurses forever: with MAX_DEPTH 3 and a top-level run at depth
    // 0, exactly 3 child runs start (depths 1–3) and the 4th is refused.
    const deep = defineChain({
      name: "deep",
      description: "",
      input: z.object({}),
      async run(_input, ctx: ChainCtx) {
        const child = await ctx.run("deep", {});
        return { refused: !child.ok, error: child.error?.message };
      },
    });
    const engine = createEngine({
      repo,
      messenger: scriptedMessenger(async () => {}),
      recipes: { deep },
    });
    const { events, result } = await runToEnd(engine.start("deep", {}));
    // Without a cap this recurses forever; it terminated and wound down cleanly,
    // and the depth-limit refusal shows up on the (nested) event stream.
    expect(result.status).toBe("completed");
    expect(JSON.stringify(events)).toContain("depth limit");
  });

  it("treats a cancelled chain as cancelled", async () => {
    const slow = defineChain({
      name: "slow",
      description: "",
      input: z.object({}),
      async run(_input, ctx: ChainCtx) {
        await ctx.run("leaf", { tag: "a" });
        await ctx.run("leaf", { tag: "b" });
        return { done: true };
      },
    });
    const engine = createEngine({
      repo,
      messenger: scriptedMessenger((req) => write(req.cwd, "f.txt", "x"), { delayMs: 40 }),
      recipes: { leaf, slow },
    });
    const run = engine.start("slow", {});
    const drained = drain(run.events);
    await new Promise((r) => setTimeout(r, 15));
    run.cancel();
    const result = await run.done;
    await drained;
    expect(result.status).toBe("cancelled");
  });
});

describe("registry: recipes and chains together", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeScratchRepo();
  });
  afterEach(() => cleanup(repo));

  it("lists a chain's name, description and schema via recipes()", () => {
    const aChain = defineChain({
      name: "a-chain",
      description: "does a thing",
      input: z.object({ issue: z.number() }),
      async run() {
        return {};
      },
    });
    const engine = createEngine({
      repo,
      messenger: scriptedMessenger(async () => {}),
      recipes: { "a-chain": aChain },
    });
    const info = engine.recipes()[0];
    expect(info?.name).toBe("a-chain");
    expect(info?.description).toBe("does a thing");
    expect(JSON.stringify(info?.inputSchema)).toContain("issue");
  });

  it("rejects bad input to a chain without running it", async () => {
    let ran = false;
    const strict = defineChain({
      name: "strict",
      description: "",
      input: z.object({ n: z.number() }),
      async run() {
        ran = true;
        return {};
      },
    });
    const engine = createEngine({
      repo,
      messenger: scriptedMessenger(async () => {}),
      recipes: { strict },
    });
    const { result } = await runToEnd(engine.start("strict", { n: "nope" }));
    expect(result.status).toBe("failed");
    expect(result.error?.kind).toBe("invalid_input");
    expect(ran).toBe(false);
  });
});
