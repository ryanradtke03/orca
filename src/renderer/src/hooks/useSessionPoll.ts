import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project, Session } from '../../../shared/ipc-contract'
import { orca } from '../api/orca-client'
import { describeError } from '../describe-error'
import { removeSessionFromState, upsertSession } from '../view-models/session'

const SESSION_STATUS_POLL_INTERVAL_MS = 2000

export interface SessionPoll {
  projects: Project[]
  sessions: Session[]
  /** Re-fetches both projects and sessions - used after an action that can change either (add project, spawn, adopt, set merge mode). */
  refreshAll: () => Promise<void>
  /** Re-fetches sessions only - used after an action that only changes session state (stop, respond, merge, discard). */
  refreshSessions: () => Promise<void>
  /** Applies a single engine-returned Session (from a mutation like stop/spawn) to local state at once, ahead of the next poll tick. */
  applySession: (session: Session) => void
  /** Drops a removed Session from local state at once, ahead of the next poll tick (after removeSession). */
  dropSession: (sessionId: string) => void
  loadError: string
}

export function useSessionPoll(): SessionPoll {
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [loadError, setLoadError] = useState('')
  // Each guards only its own kind of request against a stale, out-of-order
  // response from an earlier call of the *same* function (e.g. two rapid
  // refreshAll calls) - kept separate so a fast-resolving 2s refreshSessions
  // tick can't invalidate (and drop) a slower, still-in-flight refreshAll
  // triggered by an action like adding a project.
  const allToken = useRef(0)
  const sessionsToken = useRef(0)

  const refreshAll = useCallback(async () => {
    const token = ++allToken.current
    try {
      const [nextProjects, nextSessions] = await Promise.all([orca.listProjects(), orca.listSessions()])
      if (token !== allToken.current) return
      setProjects(nextProjects)
      setSessions(nextSessions)
      setLoadError('')
    } catch (error) {
      if (token !== allToken.current) return
      setLoadError(`Failed to load projects: ${describeError(error)}`)
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    const token = ++sessionsToken.current
    try {
      const nextSessions = await orca.listSessions()
      if (token !== sessionsToken.current) return
      setSessions(nextSessions)
      setLoadError('')
    } catch (error) {
      if (token !== sessionsToken.current) return
      setLoadError(`Failed to refresh session statuses: ${describeError(error)}`)
    }
  }, [])

  // Optimistic update: reflect a mutation's returned Session immediately rather
  // than waiting up to ~2s for the next refreshSessions tick to reconcile it.
  const applySession = useCallback((session: Session) => {
    setSessions((prev) => upsertSession(prev, session))
  }, [])

  // Optimistic removal: drop a just-removed session now rather than waiting for
  // the next refreshSessions tick to observe it gone.
  const dropSession = useCallback((sessionId: string) => {
    setSessions((prev) => removeSessionFromState(prev, sessionId))
  }, [])

  useEffect(() => {
    void refreshAll()
    const interval = setInterval(() => void refreshSessions(), SESSION_STATUS_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
    // Only ever set up once - refreshAll/refreshSessions are stable (useCallback with no deps).
  }, [])

  return { projects, sessions, refreshAll, refreshSessions, applySession, dropSession, loadError }
}
