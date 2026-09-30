import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import type { MessengerRequest } from "./types.js";

/** A request with every default filled in. Backends only ever see this. */
export interface ValidRequest {
  prompt: string;
  system: string | undefined;
  tools: string[];
  cwd: string | undefined;
  maxTurns: number;
  model: string | undefined;
  resume: string | undefined;
  timeoutMs: number;
  signal: AbortSignal | undefined;
}

export interface RequestDefaults {
  timeoutMs: number;
  model: string | undefined;
}

export type ValidateResult =
  | { ok: true; value: ValidRequest }
  | { ok: false; error: string };

/**
 * Fill defaults and reject requests that can't work. Returns a result instead of throwing,
 * so send() can turn a bad request into a normal failed DoneEvent.
 */
export function validateRequest(
  req: MessengerRequest,
  defaults: RequestDefaults,
): ValidateResult {
  const tools = req.tools ?? [];

  if (!req.prompt || !req.prompt.trim()) {
    return { ok: false, error: "prompt is empty" };
  }
  if (tools.length > 0 && !req.cwd) {
    return {
      ok: false,
      error:
        "cwd is required when tools are enabled (the agent needs a folder to work in)",
    };
  }
  // A missing cwd makes spawn fail with ENOENT, which looks exactly like "claude not found".
  // Catch it here so the error says what's actually wrong.
  if (req.cwd && !(existsSync(req.cwd) && statSync(req.cwd).isDirectory())) {
    return {
      ok: false,
      error: `cwd does not exist or is not a folder: ${req.cwd}`,
    };
  }
  if (
    req.maxTurns !== undefined &&
    (!Number.isInteger(req.maxTurns) || req.maxTurns < 1)
  ) {
    return {
      ok: false,
      error: `maxTurns must be a whole number ≥ 1 (got ${req.maxTurns})`,
    };
  }
  if (req.timeoutMs !== undefined && !(req.timeoutMs > 0)) {
    return { ok: false, error: `timeoutMs must be > 0 (got ${req.timeoutMs})` };
  }

  return {
    ok: true,
    value: {
      prompt: req.prompt,
      system: req.system,
      tools,
      // Talk-only calls default to a temp folder, so the run doesn't pick up
      // a CLAUDE.md from wherever the script happened to be launched.
      cwd: req.cwd ?? (tools.length === 0 ? tmpdir() : undefined),
      maxTurns: req.maxTurns ?? (tools.length > 0 ? 20 : 1),
      model: req.model ?? defaults.model,
      resume: req.resume,
      timeoutMs: req.timeoutMs ?? defaults.timeoutMs,
      signal: req.signal,
    },
  };
}
