import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TranscriptMessage } from '../../../shared/ipc-contract'
import { orca } from '../api/orca-client'
import { describeError } from '../describe-error'

const TRANSCRIPT_POLL_INTERVAL_MS = 2000

export interface TranscriptLoad {
  messages: TranscriptMessage[]
  /** Set only if the *initial* load failed; poll failures log and are ignored. */
  loadError: string | null
  /**
   * Optimistically shows `text` as a just-sent user message right away, so a
   * send reflects instantly rather than after the ~1s write path resolves.
   * Returns an id to hand `settleOptimistic` once the send lands (or fails).
   */
  appendOptimistic: (text: string) => string
  /**
   * Reconciles an optimistic message once its send settled: on success, fetches
   * the server transcript (which now carries the message) and drops the local
   * echo in the same render so it never flickers; on failure, just drops it.
   */
  settleOptimistic: (id: string, sent: boolean) => Promise<void>
}

/**
 * Loads a session's transcript, then live-updates it on a 2s cadence (#45). It
 * is the live-mode fallback: in mock mode the richer transcript (tool calls +
 * permission card) rides along on the session itself and the screen prefers
 * that. The *initial* load's failure surfaces as `loadError`; a transient poll
 * failure only logs, so a blip never tears down an already-rendered screen.
 *
 * Optimistic sends ride in a separate `pending` list appended after the server
 * transcript, so a just-sent message shows instantly and is dropped only once
 * the server copy has landed (see settleOptimistic). A request token (`seq`)
 * means the most recent fetch always wins, so a slow background poll can't
 * clobber a fresher post-send fetch with its stale result; `inFlight` only
 * throttles the background poll, never a forced fetch.
 */
export function useTranscript(sessionId: string): TranscriptLoad {
  const [serverMessages, setServerMessages] = useState<TranscriptMessage[]>([])
  const [pending, setPending] = useState<TranscriptMessage[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const inFlight = useRef(false)
  // Monotonic request id: a fetch's result is only used if it is still the
  // latest, so an out-of-order response (a slow poll resolving after a fresh
  // fetch, or one arriving after navigating away) is dropped.
  const seq = useRef(0)
  const activeSessionId = useRef(sessionId)

  const messages = useMemo(() => [...serverMessages, ...pending], [serverMessages, pending])

  // Fetches the transcript and returns it, or null when the result is stale
  // (superseded by a newer request, a different session, or a failure). Doesn't
  // touch state itself, so callers can apply it together with related updates in
  // one render. `force` fetches even while a background poll is outstanding (so a
  // send reflects at once); the plain poll throttles itself so ticks don't stack.
  const fetchTranscript = useCallback(async (force: boolean): Promise<TranscriptMessage[] | null> => {
    if (inFlight.current && !force) return null
    inFlight.current = true
    const token = ++seq.current
    const forSessionId = activeSessionId.current
    try {
      const next = await orca.getTranscript(forSessionId)
      return token === seq.current && activeSessionId.current === forSessionId ? next : null
    } catch (error) {
      console.error(`Failed to refresh transcript for ${forSessionId}:`, error)
      return null
    } finally {
      inFlight.current = false
    }
  }, [])

  const appendOptimistic = useCallback((text: string): string => {
    const id = crypto.randomUUID()
    setPending((prev) => [...prev, { id, role: 'user', text, timestamp: Date.now() }])
    return id
  }, [])

  const settleOptimistic = useCallback(
    async (id: string, sent: boolean): Promise<void> => {
      // On success the engine has appended this message, so pull the fresh
      // server copy and drop the echo together - React batches both updates into
      // one render, so the message never blinks out between them. On failure the
      // server never got it, so just roll the echo back.
      if (sent) {
        const next = await fetchTranscript(true)
        if (next) setServerMessages(next)
      }
      setPending((prev) => prev.filter((message) => message.id !== id))
    },
    [fetchTranscript]
  )

  // Initial load. Clears optimistic sends carried over from a previous session.
  useEffect(() => {
    let cancelled = false
    activeSessionId.current = sessionId
    const token = ++seq.current
    setServerMessages([])
    setPending([])
    setLoadError(null)
    setLoaded(false)

    orca
      .getTranscript(sessionId)
      .then((next) => {
        if (cancelled || token !== seq.current) return
        setServerMessages(next)
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
    const interval = setInterval(() => {
      void fetchTranscript(false).then((next) => {
        if (next) setServerMessages(next)
      })
    }, TRANSCRIPT_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [loaded, fetchTranscript])

  return { messages, loadError, appendOptimistic, settleOptimistic }
}
