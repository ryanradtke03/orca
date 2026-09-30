// packages/messenger/src/types.ts

// ── What you send ─────────────────────────────────────────────

/** The parts of AbortSignal the messenger uses. A real AbortSignal fits this shape. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface MessengerRequest {
  prompt: string;
  system?: string | undefined;
  tools?: string[] | undefined; // [] = talk only
  cwd?: string | undefined; // required when tools is non-empty
  maxTurns?: number | undefined; // defaults: 1 for talk-only, 20 with tools
  model?: string | undefined; // e.g. "sonnet", "haiku", "opus"; default = your Claude Code default
  resume?: string | undefined; // session id, to continue a conversation
  timeoutMs?: number | undefined;
  signal?: AbortSignalLike | undefined; // lets the engine cancel a run
}

// ── What comes back ───────────────────────────────────────────
export type MessengerErrorKind =
  | "invalid_request" // bad request, no process started
  | "not_found" // claude binary not found
  | "spawn" // process failed to start for another reason
  | "timeout" // killed after timeoutMs
  | "aborted" // cancelled via signal
  | "no_result" // process ended without a result line
  | "exit_code" // non-zero exit even though a result arrived
  | "max_turns" // Claude hit maxTurns before finishing
  | "claude_error"; // Claude reported some other error

export interface DoneEvent {
  type: "done";
  ok: boolean;
  text?: string | undefined;
  sessionId?: string | undefined;
  costUsd?: number | undefined;
  turns?: number | undefined;
  error?: { kind: MessengerErrorKind; message: string } | undefined;
  tracePath?: string | undefined; // set when traceDir is configured
}

export type MessengerEvent =
  | { type: "message"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      toolUseId: string;
      name?: string | undefined;
      output: unknown;
      isError?: boolean | undefined;
    }
  | DoneEvent
  | { type: "raw"; msg: unknown }; // anything we don't map yet

export interface MessengerRun {
  events: AsyncIterable<MessengerEvent>;
  done: Promise<DoneEvent>;
}

// ── The interface every backend implements ───────────────────
export interface Messenger {
  send(req: MessengerRequest): MessengerRun;
}

// ── Backend options + config ──────────────────────────────────
export interface CliMessengerOptions {
  claudePath?: string | undefined; // default "claude"; Electron may need an absolute path
  defaultTimeoutMs?: number | undefined; // default 5 minutes
  defaultModel?: string | undefined; // used when a request has no model
  traceDir?: string | undefined; // if set, save every raw line to a .jsonl file
  useApiKey?: boolean | undefined; // default false: strip ANTHROPIC_API_KEY so your subscription is used
  configDir?: string | undefined; // separate Claude Code config (no personal CLAUDE.md, skills, plugins)
  strictMcp?: boolean | undefined; // default true: load no MCP servers (e.g. your claude.ai connectors) unless passed in
}

/** A fixture is either a path to a recorded .jsonl file, or the parsed lines themselves. */
export type Fixture = string | unknown[];

export interface FakeMessengerOptions {
  /** Played in order, one per send(). Or a function that picks one per request. */
  fixtures: Fixture[] | ((req: MessengerRequest, callIndex: number) => Fixture);
  /** Pause between lines, to see streaming behave like a real run. Default 0. */
  delayMs?: number | undefined;
  /** Pretend exit code of the claude process. Default 0. */
  exitCode?: number | undefined;
}

export type MessengerConfig =
  | ({ backend: "cli" } & CliMessengerOptions)
  | ({ backend: "fake" } & FakeMessengerOptions);
