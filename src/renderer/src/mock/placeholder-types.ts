import type { FileDiff, Session, TranscriptMessage } from '../../../shared/ipc-contract'

/**
 * Renderer-local placeholder types (ticket #49).
 *
 * These carry the richer shapes the mockups show (docs/mockups/) that the
 * shared IPC contract does NOT yet model: plan steps, queued prompts,
 * transcript tool calls and in-thread permission cards, per-file review
 * progress, and per-Session model/token/turn metadata.
 *
 * They live here, never in src/shared/ipc-contract.ts, and every added field
 * is optional so live (real-IPC) mode keeps compiling and rendering -
 * degraded, never broken - until the four screen tickets fold these fields
 * into the expanded screens. When the contract grows to cover a field for
 * real, delete it here.
 */

export type PlanStepState = 'done' | 'active' | 'pending'

export interface PlanStep {
  text: string
  state: PlanStepState
}

export interface QueuedPrompt {
  text: string
  /** The dashed sub-line the inspector shows, e.g. "sends after approval". */
  note?: string
}

/** Per-file review progress the diff mockup tracks - distinct from git's FileDiffStatus. */
export interface FileReviewMeta {
  reviewed?: boolean
}

export type MockFileDiff = FileDiff & FileReviewMeta

/** Live per-Session metadata the Home rows and session inspector show. */
export interface SessionMeta {
  model?: string
  tokensUsed?: number
  tokenLimit?: number
  turns?: number
  /** Rolled-up diff totals shown on a Home row before the Diff is opened. */
  additions?: number
  deletions?: number
  fileCount?: number
  plan?: PlanStep[]
  queuedPrompts?: QueuedPrompt[]
  /** Free-text note the "Needs you" block shows, e.g. "waiting on your reply for 6m". */
  attentionNote?: string
}

export type MockSession = Session & SessionMeta

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

export type MockTranscriptEntry = MessageEntry | ToolCallEntry | PermissionCardEntry
