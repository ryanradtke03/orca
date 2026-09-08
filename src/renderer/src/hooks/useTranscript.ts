import { useEffect, useRef, useState } from 'react'
import type { TranscriptMessage } from '../../../shared/ipc-contract'
import { orca } from '../api/orca-client'
import { describeError } from '../describe-error'

const TRANSCRIPT_POLL_INTERVAL_MS = 2000

export interface TranscriptLoad {
  messages: TranscriptMessage[]
  /** Set only if the *initial* load failed; poll failures log and are ignored. */
  loadError: string | null
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

  // Initial load.
  useEffect(() => {
    let cancelled = false
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
    let cancelled = false

    const interval = setInterval(() => {
      if (inFlight.current) return
      inFlight.current = true
      orca
        .getTranscript(sessionId)
        .then((next) => {
          if (!cancelled) setMessages(next)
        })
        .catch((error: unknown) => {
          if (!cancelled) console.error(`Failed to refresh transcript for ${sessionId}:`, error)
        })
        .finally(() => {
          inFlight.current = false
        })
    }, TRANSCRIPT_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [sessionId, loaded])

  return { messages, loadError }
}
