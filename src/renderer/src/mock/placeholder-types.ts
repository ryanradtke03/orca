import type { FileDiff, Session } from '../../../shared/ipc-contract'
import type { PlanStep, QueuedPrompt } from '../session-view'
import type { TranscriptEntry } from '../transcript-view'

/**
 * Renderer-local placeholder types (ticket #49).
 *
 * These carry the richer shapes the mockups show (docs/mockups/) that the
 * shared IPC contract does NOT yet model: plan steps, queued prompts,
 * transcript tool calls and in-thread permission cards, per-file review
 * progress, and per-Session model/token/turn metadata.
 *
 * The presentational shapes themselves now live with the screens that render
 * them (session-view / transcript-view) - #51 folded them out of here as it
 * built the session screen. This module keeps the mock-only compositions
 * (fixtures, ride-along Session/FileDiff) and re-exports the shared ones so the
 * fixtures keep a single import site. Every added field stays optional so live
 * (real-IPC) mode keeps compiling and rendering - degraded, never broken.
 */

export type { PlanStep, PlanStepState, QueuedPrompt } from '../session-view'
export type {
  MessageEntry,
  PermissionCardEntry,
  ToolCallEntry,
  ToolCallState
} from '../transcript-view'

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
  /** The full transcript (incl. tool calls and the permission card) the session screen renders. */
  transcript?: MockTranscriptEntry[]
  /** Free-text note the "Needs you" block shows, e.g. "waiting on your reply for 6m". */
  attentionNote?: string
  /** Short relative-activity label the session nav shows, e.g. "1m" or "31m". */
  activityLabel?: string
}

export type MockSession = Session & SessionMeta

export type MockTranscriptEntry = TranscriptEntry
