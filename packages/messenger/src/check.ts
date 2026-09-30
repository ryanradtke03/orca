import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CliMessenger } from "./backends/cli/index.js";
import { collect } from "./helpers.js";
import type { CliMessengerOptions } from "./types.js";

const run = promisify(execFile);

export interface ClaudeHealth {
  installed: boolean;
  version?: string | undefined;
  /** A tiny test prompt got a successful reply. */
  loggedIn?: boolean | undefined;
  /** A rate_limit_event appeared, which only happens on subscription logins. */
  onSubscription?: boolean | undefined;
  /** ANTHROPIC_API_KEY is set in this process (the messenger strips it unless useApiKey). */
  apiKeyInEnv: boolean;
  error?: string | undefined;
}

/**
 * Is Claude Code installed, logged in, and on the subscription?
 * ping: false skips the test prompt (no usage, but can't confirm login).
 */
export async function checkClaude(
  opts: CliMessengerOptions & { ping?: boolean } = {},
): Promise<ClaudeHealth> {
  const apiKeyInEnv = Boolean(
    process.env["ANTHROPIC_API_KEY"] || process.env["ANTHROPIC_AUTH_TOKEN"],
  );
  const bin = opts.claudePath ?? "claude";

  let version: string;
  try {
    version = (
      await run(bin, ["--version"], { timeout: 15_000 })
    ).stdout.trim();
  } catch (err) {
    const notFound = (err as NodeJS.ErrnoException).code === "ENOENT";
    return {
      installed: false,
      apiKeyInEnv,
      error: notFound
        ? `"${bin}" not found. Install Claude Code or set claudePath.`
        : String(err),
    };
  }
  if (opts.ping === false) return { installed: true, version, apiKeyInEnv };

  const m = new CliMessenger({
    ...opts,
    defaultModel: opts.defaultModel ?? "haiku",
  });
  const { events, done } = await collect(
    m.send({ prompt: "Reply with exactly: ok", timeoutMs: 60_000 }),
  );
  const onSubscription = events.some(
    (e) =>
      e.type === "raw" &&
      (e.msg as { type?: string })?.type === "rate_limit_event",
  );

  return {
    installed: true,
    version,
    loggedIn: done.ok,
    onSubscription,
    apiKeyInEnv,
    error: done.ok ? undefined : done.error?.message,
  };
}
