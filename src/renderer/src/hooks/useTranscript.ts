import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranscriptMessage } from '../../../shared/ipc-contract'
import { orca } from '../api/orca-client'
import { describeError } from '../describe-error'

const TRANSCRIPT_POLL_INTERVAL_MS = 2000

export interface TranscriptLoad {
  messages: TranscriptMessage[]
  /** Set only if the *initial* load failed; poll failures log and are ignored. */
  loadError: string | null
  /**
   * Re-fetches the transcript now, ahead of the next 2s tick - used after a
   * send so the engine's just-appended message shows without the poll delay.
   * Failures only log (like a poll tick), never surfacing over already-good content.
   */
  refresh: () => void
}

/**
 * Loads a session's transcript, then live-updates it on a 2s cadence (#45). It
 * is the live-mode fallback: in mock mode the richer transcript (tool calls +
 * permission card) rides along on the session itself and the screen prefers
 * that. The *initial* load's failure surfaces as `loadError`; a transient poll
 * failure only logs, so a blip never tears down an already-rendered screen.
 * `inFlight` skips a tick while the previous fetch is still outstanding;
 * `cancelled` drops a response that resolves after navigating away.
 */
export function useTranscript(sessionId: string): TranscriptLoad {
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const inFlight = useRef(false)
  // The session the latest fetch was for, so a response that resolves after
  // navigating to another session (or back) is dropped rather than applied.
  const activeSessionId = useRef(sessionId)

  // A single non-initial fetch: refreshes messages, only logs on failure, and
  // skips while a previous fetch is still outstanding. Shared by the 2s poll
  // and the on-demand `refresh` a send triggers.
  const poll = useCallback((): void => {
    if (inFlight.current) return
    inFlight.current = true
    const forSessionId = activeSessionId.current
    orca
      .getTranscript(forSessionId)
      .then((next) => {
        if (activeSessionId.current === forSessionId) setMessages(next)
      })
      .catch((error: unknown) => {
        console.error(`Failed to refresh transcript for ${forSessionId}:`, error)
      })
      .finally(() => {
        inFlight.current = false
      })
  }, [])

  // Initial load.
  useEffect(() => {
    let cancelled = false
    activeSessionId.current = sessionId
    setMessages([])
    setLoadError(null)
    setLoaded(false)

    orca
      .getTranscript(sessionId)
      .then((next) => {
        if (cancelled) return
        setMessages(next)
        setLoaded(true)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(describeError(error))
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Poll, but only once the initial load has landed.
  useEffect(() => {
    if (!loaded) return
    const interval = setInterval(poll, TRANSCRIPT_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [loaded, poll])

  return { messages, loadError, refresh: poll }
}
