import type { TranscriptMessage } from '../../shared/ipc-contract'

/**
 * Presentational transcript shapes the session screen (05b mockup) renders:
 * a conversation is not just messages but also inline tool-call chips and an
 * in-thread permission card, interleaved in order.
 *
 * These live in the renderer (not the shared IPC contract) because the engine
 * doesn't model them yet - the mock backend rides a full entry list along on a
 * Session for the expanded screen, and live mode falls back to plain messages
 * via `messagesToEntries`. When the contract grows to carry tool calls and
 * permission cards for real, this collapses into it (see mock/placeholder-types).
 */

export type ToolCallState = 'ok' | 'blocked' | 'running'

/** A tool call rendered inline in the transcript, e.g. Edit(...) or Bash(...). */
export interface ToolCallEntry {
  kind: 'tool-call'
  id: string
  label: string
  state: ToolCallState
  additions?: number
  deletions?: number
}

/** An in-thread permission card - answered inline in the transcript, not in a modal. */
export interface PermissionCardEntry {
  kind: 'permission-card'
  id: string
  command: string
  detail: string
  /** e.g. "waiting 1m 12s". */
  waitingFor?: string
}

export interface MessageEntry {
  kind: 'message'
  message: TranscriptMessage
}

export type TranscriptEntry = MessageEntry | ToolCallEntry | PermissionCardEntry

/**
 * The tool name a `Tool(command)` string names, e.g. "Bash(rm -rf out/)" ->
 * "Bash" - used for the permission card's "Always allow {Tool}" label. Returns
 * undefined for text that isn't shaped like an identifier followed by an open
 * paren, so prose never produces a bogus tool name.
 */
export function toolNameFromCommand(command: string): string | undefined {
  return /^([A-Za-z]\w*)\(/.exec(command.trim())?.[1]
}

/** Wraps plain contract messages as transcript entries - the live-mode fallback when no rich entry list rode along. */
export function messagesToEntries(messages: TranscriptMessage[]): MessageEntry[] {
  return messages.map((message) => ({ kind: 'message', message }))
}
