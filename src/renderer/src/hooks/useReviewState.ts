import { useCallback, useState } from 'react'
import { markReviewed, reviewedPathsFor, toggleReviewed, type ReviewState } from '../view-models/review'

export interface ReviewProgress {
  /** The reviewed file paths for one session (empty until the user marks any). */
  reviewedPathsFor: (sessionId: string) => readonly string[]
  /** Marks/unmarks one file reviewed in the given session (the footer toggle). */
  toggleReviewed: (sessionId: string, path: string) => void
  /** Marks one file reviewed idempotently (the `a` mark-and-advance keybind). */
  markReviewed: (sessionId: string, path: string) => void
}

/**
 * Owns the app's per-session review progress. Lifted above the diff screen (in
 * App) so a session's "N / M reviewed" survives navigating away and back - the
 * diff screen itself unmounts on every navigation. Pure store logic lives in
 * view-models/review.ts; this only holds it in React state.
 */
export function useReviewState(): ReviewProgress {
  const [state, setState] = useState<ReviewState>({})
  return {
    reviewedPathsFor: useCallback((sessionId: string) => reviewedPathsFor(state, sessionId), [state]),
    toggleReviewed: useCallback(
      (sessionId: string, path: string) => setState((prev) => toggleReviewed(prev, sessionId, path)),
      []
    ),
    markReviewed: useCallback(
      (sessionId: string, path: string) => setState((prev) => markReviewed(prev, sessionId, path)),
      []
    )
  }
}
