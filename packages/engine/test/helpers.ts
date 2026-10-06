import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  DoneEvent,
  Messenger,
  MessengerEvent,
  MessengerRequest,
  MessengerRun,
} from "@orchestra/messenger";
import { createBudget } from "../src/budget.js";
import { exec as runCommand } from "../src/exec.js";
import type { EngineEvent, EngineLimits, EngineRun, RunCtx } from "../src/types.js";

const exec = promisify(execFile);

/** A temporary git repo with `files` committed. Caller cleans up with `cleanup()`. */
export async function makeScratchRepo(
  files: Record<string, string> = { "index.ts": "export const x = 1;\n" },
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "orca-test-"));
  const git = (args: string[]) => exec("git", args, { cwd: dir });
  await git(["init", "-q"]);
  await git(["config", "user.email", "test@orca.dev"]);
  await git(["config", "user.name", "Orca Test"]);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "initial"]);
  return dir;
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

export interface HandlerOut {
  ok?: boolean;
  costUsd?: number;
}
export type SendHandler = (
  req: MessengerRequest,
) => Promise<HandlerOut> | Promise<void> | HandlerOut;

/**
 * A Messenger that runs a handler (which can edit req.cwd) instead of calling
 * Claude — the ScriptedMessenger the design calls for, since a replay-only fake
 * leaves the worktree untouched and gates would have nothing to check.
 */
export function scriptedMessenger(
  handler: SendHandler,
  opts: { delayMs?: number } = {},
): Messenger & { calls: MessengerRequest[] } {
  const calls: MessengerRequest[] = [];
  return {
    calls,
    send(req): MessengerRun {
      calls.push(req);
      const work = (async (): Promise<DoneEvent> => {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        const out = ((await handler(req)) as HandlerOut | undefined) ?? {};
        return { type: "done", ok: out.ok ?? true, costUsd: out.costUsd ?? 0.001, turns: 1 };
      })();
      async function* events(): AsyncGenerator<MessengerEvent> {
        yield await work;
      }
      return { events: events(), done: work };
    },
  };
}

export const write = (cwd: string | undefined, name: string, body: string) =>
  writeFile(path.join(cwd ?? ".", name), body);

export async function drain(events: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const seen: EngineEvent[] = [];
  for await (const e of events) seen.push(e);
  return seen;
}

export async function runToEnd(run: EngineRun) {
  const events = await drain(run.events);
  const result = await run.done;
  return { events, result };
}

/** Build a RunCtx for calling runTask/schedule directly in a test. */
export function makeRunCtx(opts: {
  repo: string;
  messenger: Messenger;
  limits?: Partial<EngineLimits>;
  emit?: (e: EngineEvent) => void;
  signal?: AbortSignal;
}): RunCtx {
  const limits: EngineLimits = {
    maxWorkers: 2,
    maxAttempts: 3,
    maxCostUsd: 3,
    maxDurationMs: 10 * 60 * 1000,
    ...opts.limits,
  };
  const emit = opts.emit ?? (() => {});
  return {
    repo: opts.repo,
    messenger: opts.messenger,
    signal: opts.signal ?? new AbortController().signal,
    emit,
    exec: (cmd, execOpts) =>
      runCommand(opts.repo, cmd, execOpts).then((r) => ({
        code: r.code,
        output: `${r.stdout}${r.stderr}`,
      })),
    runId: "run-test",
    limits,
    budget: createBudget(limits, emit),
    keepWorktrees: "never",
    approvePlan: false,
    waitApproval: () => Promise.resolve(true),
  };
}
