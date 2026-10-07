// The Bug to PR chain, end to end in-process: real engine, real chain, a local PR
// sink, and stand-in child recipes registered under the names the chain calls
// (repro-bug, fix-ci, pr-review, pr-describe). The stand-ins make deterministic
// edits and outputs through a scripted messenger, so the test exercises the
// chain's wiring — base refs, git commits, the PR tail, the exits — without Claude.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createEngine, defineRecipe, localSink, type Registered } from "@orchestra/engine";
import type {
  DoneEvent,
  Messenger,
  MessengerEvent,
  MessengerRequest,
  MessengerRun,
} from "@orchestra/messenger";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type BugToPrOutput, bugToPr } from "../src/bug-to-pr/index.js";

const exec = promisify(execFile);
const git = (cwd: string, args: string[]) =>
  exec("git", args, { cwd }).then((r) => r.stdout.trim());

// ── A scripted messenger the stand-in recipes drive ───────────
// Each worker's prompt starts with a marker (SYN:<name>). The handler edits the
// worktree for repro-bug / fix-ci, and can be told to fail a given recipe.
interface Script {
  fail: Set<string>;
}

function scriptedMessenger(script: Script): Messenger {
  return {
    send(req: MessengerRequest): MessengerRun {
      const marker = /^SYN:(\S+)/.exec(req.prompt)?.[1] ?? "";
      const work = (async (): Promise<DoneEvent> => {
        if (marker === "repro-bug") {
          await write(req.cwd, "test/repro/issue-1.test.ts", "test('bug', () => {})\n");
        } else if (marker === "fix-ci") {
          await write(req.cwd, "src/patch.ts", "export const fixed = true;\n");
        }
        const ok = !script.fail.has(marker);
        return { type: "done", ok, costUsd: 0.001, turns: 1 };
      })();
      async function* events(): AsyncGenerator<MessengerEvent> {
        yield await work;
      }
      return { events: events(), done: work };
    },
  };
}

async function write(cwd: string | undefined, rel: string, body: string): Promise<void> {
  const full = path.join(cwd ?? ".", rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
}

// ── Stand-in child recipes (same names the chain calls) ───────
const synReproBug = defineRecipe({
  name: "repro-bug",
  description: "",
  input: z.object({
    report: z.string(),
    test: z.string().default("pnpm vitest run"),
    issue: z.number().optional(),
  }),
  async plan(input) {
    const command = `${input.test} test/repro/issue-1.test.ts`;
    return [
      {
        id: "repro",
        goal: "SYN:repro-bug write a failing test",
        dependsOn: [],
        context: { command },
      },
    ];
  },
  worker: (task) => ({ prompt: task.goal, tools: ["Write"], maxTurns: 1 }),
  gates: [],
  async finish(results) {
    const ok = results.every((r) => r.ok) && results.length > 0;
    return {
      reproduced: ok,
      reproFile: "test/repro/issue-1.test.ts",
      command: String(results[0]?.task.context["command"] ?? ""),
      reason: ok ? undefined : "the report describes correct behavior; no failing test",
    };
  },
});

const synFixCi = defineRecipe({
  name: "fix-ci",
  description: "",
  input: z.object({ command: z.string() }),
  async plan() {
    return [{ id: "fix", goal: "SYN:fix-ci fix the source", dependsOn: [], context: {} }];
  },
  worker: (task) => ({ prompt: task.goal, tools: ["Write"], maxTurns: 1 }),
  gates: [],
  async finish(results) {
    return { fixed: results.every((r) => r.ok), diffs: results.map((r) => r.diff) };
  },
});

const synPrReview = defineRecipe({
  name: "pr-review",
  description: "",
  input: z.object({
    base: z.string().default("main"),
    head: z.string(),
    issue: z.string().optional(),
  }),
  async plan() {
    return [{ id: "review", goal: "SYN:pr-review", dependsOn: [], context: {} }];
  },
  worker: (task) => ({ prompt: task.goal, tools: [], maxTurns: 1 }),
  gates: [],
  async finish() {
    return {
      verdict: "approve",
      summary: "fixes the root cause; no side effects found.",
      comments: [],
    };
  },
});

const synPrDescribe = defineRecipe({
  name: "pr-describe",
  description: "",
  input: z.object({
    base: z.string().default("main"),
    head: z.string(),
    issue: z.object({ number: z.number(), text: z.string() }).optional(),
    evidence: z.array(z.unknown()).default([]),
  }),
  async plan() {
    return [{ id: "describe", goal: "SYN:pr-describe", dependsOn: [], context: {} }];
  },
  worker: (task) => ({ prompt: task.goal, tools: [], maxTurns: 1 }),
  gates: [],
  async finish() {
    return {
      title: "Fix #1: median of an even-length list",
      body: "Fixes #1\n\nAverages the two middle values.\n\n## Testing\n- repro passes (fix-ci)",
      parsed: {},
    };
  },
});

const RECIPES = {
  "repro-bug": synReproBug,
  "fix-ci": synFixCi,
  "pr-review": synPrReview,
  "pr-describe": synPrDescribe,
  "bug-to-pr": bugToPr,
} satisfies Record<string, Registered>;

// ── Harness ───────────────────────────────────────────────────
async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "orca-bug2pr-"));
  await git(dir, ["init", "-q", "-b", "main"]);
  await git(dir, ["config", "user.email", "t@orca.dev"]);
  await git(dir, ["config", "user.name", "Orca Test"]);
  await write(dir, "src/stats.ts", "export const median = () => 3;\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

function makeEngine(repo: string, script: Script) {
  return createEngine({
    repo,
    messenger: scriptedMessenger(script),
    recipes: RECIPES,
    pr: localSink({ dir: path.join(repo, ".orca") }),
    keepWorktrees: "never",
  });
}

async function runChain(repo: string, script: Script, input: Record<string, unknown>) {
  const engine = makeEngine(repo, script);
  const run = engine.start("bug-to-pr", input);
  const events: string[] = [];
  for await (const e of run.events) events.push(e.type);
  const result = await run.done;
  return { result, events, output: result.output as BugToPrOutput };
}

describe("bug-to-pr chain", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
    // the issue the local sink reads for a report
    await write(
      repo,
      ".orca/issues/1.md",
      "Median bug\n\nmedian([1,2,3,4]) returns 3, should be 2.5\n",
    );
  });
  afterEach(() => rm(repo, { recursive: true, force: true }));

  it("c-happy: reproduces, fixes, reviews and opens a draft PR", async () => {
    const headBefore = await git(repo, ["rev-parse", "HEAD"]);
    const { result, output } = await runChain(repo, { fail: new Set() }, { issue: 1 });

    expect(result.status).toBe("completed");
    expect(output.status).toBe("pr_opened");
    expect(output.verdict).toBe("approve");
    expect(output.branch).toBe("orca/bug-1");

    // the branch has exactly the test commit + the fix commit over main
    expect(await git(repo, ["rev-list", "--count", "main..orca/bug-1"])).toBe("2");
    const log = await git(repo, ["log", "--format=%s", "main..orca/bug-1"]);
    expect(log).toContain("test: reproduce #1");
    expect(log).toContain("fix: #1");

    // main and the checkout never moved (the sink's own .orca/ output aside)
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(await git(repo, ["status", "--porcelain", "--untracked-files=no"])).toBe("");

    // the PR file and the issue comment were written by the local sink
    const pr = await readFile(path.join(repo, ".orca/prs/orca/bug-1.md"), "utf8");
    expect(pr).toContain("draft: true");
    expect(pr).toContain("Fixes #1");
    expect(pr).toContain("Review (orca, approve)");
    const comment = await readFile(path.join(repo, ".orca/comments/1.md"), "utf8");
    expect(comment).toContain("orca/bug-1.md");
  });

  it("c-not-a-bug: cannot reproduce — no branch, a comment explains", async () => {
    const { output } = await runChain(repo, { fail: new Set(["repro-bug"]) }, { issue: 1 });

    expect(output.status).toBe("cannot_reproduce");
    expect(output.branch).toBeUndefined();
    // no result branch was created
    await expect(git(repo, ["rev-parse", "--verify", "orca/bug-1"])).rejects.toBeTruthy();
    const comment = await readFile(path.join(repo, ".orca/comments/1.md"), "utf8");
    expect(comment).toContain("couldn't reproduce");
  });

  it("c-repro-only: fix fails — a draft PR with only the failing test", async () => {
    const { output } = await runChain(repo, { fail: new Set(["fix-ci"]) }, { issue: 1 });

    expect(output.status).toBe("repro_only");
    expect(output.branch).toBe("orca/bug-1");
    // only the test commit is on the branch
    expect(await git(repo, ["rev-list", "--count", "main..orca/bug-1"])).toBe("1");
    const pr = await readFile(path.join(repo, ".orca/prs/orca/bug-1.md"), "utf8");
    expect(pr).toContain("no fix yet");
  });

  it("takes a report directly, without an issue number", async () => {
    const { output } = await runChain(
      repo,
      { fail: new Set() },
      { report: "median([1,2,3,4]) returns 3, should be 2.5" },
    );
    expect(output.status).toBe("pr_opened");
    expect(output.branch?.startsWith("orca/bug-")).toBe(true);
    // no issue number → no comment file
    await expect(readFile(path.join(repo, ".orca/comments/1.md"), "utf8")).rejects.toBeTruthy();
  });
});
