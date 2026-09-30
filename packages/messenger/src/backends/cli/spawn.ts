import { spawn } from "node:child_process";
import readline from "node:readline";
import type { AbortSignalLike } from "../../types";

const STDERR_LIMIT = 64_000; // keep only the last 64 KB of stderr
const DEFAULT_KILL_GRACE_MS = 5_000; // time between SIGTERM and SIGKILL

export interface ExitInfo {
  code: number | null; // null if the process never started or was killed by a signal
  signal: NodeJS.Signals | null; // e.g. "SIGTERM" when we killed it
  stderr: string; // last STDERR_LIMIT characters
  timedOut: boolean; // we killed it because it ran past timeoutMs
  aborted: boolean; // we killed it because the caller's signal fired
  spawnError?: NodeJS.ErrnoException | undefined; // e.g. code "ENOENT" when the binary isn't found
}

export interface ClaudeProcess {
  lines: AsyncIterable<string>; // stdout, one line at a time
  exit: Promise<ExitInfo>; // resolves once, when the process is finished
  kill: () => void; // SIGTERM now, SIGKILL after the grace period
}

export interface SpawnOptions {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  timeoutMs: number;
  signal?: AbortSignalLike | undefined;
  killGraceMs?: number | undefined; // tests use a short value
}

/** Start the claude CLI and expose its stdout as lines, with timeout and cancellation. */
export function spawnClaude(
  bin: string,
  args: string[],
  opts: SpawnOptions,
): ClaudeProcess {
  const child = spawn(bin, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"], // no stdin; capture stdout + stderr
  });

  // ── stderr: keep the tail only, so a noisy run can't eat memory ──
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    if (stderr.length > STDERR_LIMIT) stderr = stderr.slice(-STDERR_LIMIT);
  });

  // ── killing: polite first, forceful if it ignores us ──
  let exited = false;
  let killRequested = false;
  let forceTimer: NodeJS.Timeout | undefined;
  const kill = () => {
    if (exited || killRequested) return;
    killRequested = true;
    child.kill("SIGTERM");
    forceTimer = setTimeout(() => {
      if (!exited) child.kill("SIGKILL");
    }, opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
    forceTimer.unref(); // don't keep Node alive just for this timer
  };

  // ── timeout ──
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    kill();
  }, opts.timeoutMs);

  // ── abort signal ──
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    kill();
  };
  if (opts.signal?.aborted)
    onAbort(); // cancelled before we even started
  else opts.signal?.addEventListener("abort", onAbort, { once: true });

  // ── exit: resolves exactly once, and always cleans up timers and listeners ──
  const exit = new Promise<ExitInfo>((resolve) => {
    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null,
      spawnError?: NodeJS.ErrnoException,
    ) => {
      if (exited) return;
      exited = true;
      clearTimeout(timeoutTimer);
      if (forceTimer) clearTimeout(forceTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code, signal, stderr, timedOut, aborted, spawnError });
    };
    child.once("error", (err: NodeJS.ErrnoException) =>
      finish(null, null, err),
    ); // couldn't start
    child.once("close", (code, signal) => finish(code, signal)); // ended (normally or killed)
  });

  const lines = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  return { lines, exit, kill };
}
