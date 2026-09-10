import type { FileDiff } from '../../../shared/ipc-contract'
import type { ReviewFileDiff } from './diff'

/**
 * Per-session review progress: the set of file paths the user has marked
 * reviewed on the diff screen. This is renderer-only UI state (not engine or
 * git state - a "reviewed" file is unchanged on disk), keyed by session id so
 * each session's diff remembers its own progress independently, and lives
 * above the diff screen so it survives navigating away and back.
 */
export type ReviewState = Record<string, readonly string[]>

/** The reviewed paths for one session, or an empty list if none marked yet. */
export function reviewedPathsFor(state: ReviewState, sessionId: string): readonly string[] {
  return state[sessionId] ?? []
}

export function isReviewed(state: ReviewState, sessionId: string, path: string): boolean {
  return reviewedPathsFor(state, sessionId).includes(path)
}

/** Toggles one file's reviewed flag, returning a new state (never mutates the input). */
export function toggleReviewed(state: ReviewState, sessionId: string, path: string): ReviewState {
  const current = reviewedPathsFor(state, sessionId)
  const next = current.includes(path) ? current.filter((candidate) => candidate !== path) : [...current, path]
  return { ...state, [sessionId]: next }
}

/**
 * Marks one file reviewed, returning a new state (never mutates the input).
 * Idempotent - unlike toggleReviewed it never unmarks, so the `a` keybind can
 * mark-and-advance without un-reviewing a file the user revisits. Returns the
 * same state reference when the file is already reviewed, so React can bail.
 */
export function markReviewed(state: ReviewState, sessionId: string, path: string): ReviewState {
  const current = reviewedPathsFor(state, sessionId)
  if (current.includes(path)) return state
  return { ...state, [sessionId]: [...current, path] }
}

/**
 * Stamps each file's `reviewed` flag from the app-tracked reviewed-path list,
 * so the file tree and "N / M reviewed" counter reflect the app's own review
 * state rather than whatever the diff payload happened to carry (live mode
 * carries none; mock fixtures carry a placeholder set).
 */
export function applyReviewed(files: FileDiff[], reviewedPaths: readonly string[]): ReviewFileDiff[] {
  const reviewed = new Set(reviewedPaths)
  return files.map((file) => ({ ...file, reviewed: reviewed.has(file.path) }))
}
