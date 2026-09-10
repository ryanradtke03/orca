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
 * Stamps each file's `reviewed` flag from the app-tracked reviewed-path list,
 * so the file tree and "N / M reviewed" counter reflect the app's own review
 * state rather than whatever the diff payload happened to carry (live mode
 * carries none; mock fixtures carry a placeholder set).
 */
export function applyReviewed(files: FileDiff[], reviewedPaths: readonly string[]): ReviewFileDiff[] {
  const reviewed = new Set(reviewedPaths)
  return files.map((file) => ({ ...file, reviewed: reviewed.has(file.path) }))
}
