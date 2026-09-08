import { useEffect, useState } from 'react'
import type { FileDiff } from '../../../shared/ipc-contract'
import { orca } from '../api/orca-client'
import { describeError } from '../describe-error'

export interface DiffLoad {
  /** The session's file diffs, or null while the initial load is in flight. */
  files: FileDiff[] | null
  /** A describe-error string if the load failed, else null. */
  loadError: string | null
}

/**
 * Loads `getDiff` for a session, once per sessionId - shared by the diff screen
 * and the session screen's inspector. Re-fetching a `git diff` on every 2s
 * status-poll tick would be wasteful, so it reacts only to navigating to a
 * (possibly different) session, not to the polled `sessions` array changing
 * underneath it.
 */
export function useDiff(sessionId: string): DiffLoad {
  const [files, setFiles] = useState<FileDiff[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setFiles(null)
    setLoadError(null)

    orca
      .getDiff(sessionId)
      .then((next) => {
        if (!cancelled) setFiles(next)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(describeError(error))
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  return { files, loadError }
}
