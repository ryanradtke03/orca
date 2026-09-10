import { useCallback, useState } from 'react'
import { reviewedPathsFor, toggleReviewed, type ReviewState } from '../view-models/review'

export interface ReviewProgress {
  /** The reviewed file paths for one session (empty until the user marks any). */
  reviewedPathsFor: (sessionId: string) => readonly string[]
  /** Marks/unmarks one file reviewed in the given session. */
  toggleReviewed: (sessionId: string, path: string) => void
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
    )
  }
}
