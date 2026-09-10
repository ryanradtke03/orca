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
  // Ids of sessions removed optimistically via dropSession. The tokens above
  // only invalidate a stale response against a *newer call of the same
  // function*; they don't help when a poll's listSessions() was already in
  // flight when a removal landed - that response still carries the removed
  // session and would resurrect it for ~2s. Filtering fetched lists through
  // these tombstones closes that window. Each clears itself the first time a
  // fetched list confirms the session is gone (see reconcile), so the set
  // can't grow unbounded and a truly-gone session can never be re-added.
  const removedIds = useRef<Set<string>>(new Set())

  // Drops tombstoned ids from a freshly-fetched list, and forgets any tombstone
  // the engine has now confirmed absent (so later polls needn't keep filtering).
  const reconcile = useCallback((list: Session[]): Session[] => {
    if (removedIds.current.size === 0) return list
    const present = new Set(list.map((session) => session.id))
    for (const id of removedIds.current) {
      if (!present.has(id)) removedIds.current.delete(id)
    }
    if (removedIds.current.size === 0) return list
    return list.filter((session) => !removedIds.current.has(session.id))
  }, [])

  const refreshAll = useCallback(async () => {
    const token = ++allToken.current
    try {
      const [nextProjects, nextSessions] = await Promise.all([orca.listProjects(), orca.listSessions()])
      if (token !== allToken.current) return
      setProjects(nextProjects)
      setSessions(reconcile(nextSessions))
      setLoadError('')
    } catch (error) {
      if (token !== allToken.current) return
      setLoadError(`Failed to load projects: ${describeError(error)}`)
    }
  }, [reconcile])

  const refreshSessions = useCallback(async () => {
    const token = ++sessionsToken.current
    try {
      const nextSessions = await orca.listSessions()
      if (token !== sessionsToken.current) return
      setSessions(reconcile(nextSessions))
      setLoadError('')
    } catch (error) {
      if (token !== sessionsToken.current) return
      setLoadError(`Failed to refresh session statuses: ${describeError(error)}`)
    }
  }, [reconcile])

  // Optimistic update: reflect a mutation's returned Session immediately rather
  // than waiting up to ~2s for the next refreshSessions tick to reconcile it.
  const applySession = useCallback((session: Session) => {
    setSessions((prev) => upsertSession(prev, session))
  }, [])

  // Optimistic removal: drop a just-removed session now rather than waiting for
  // the next refreshSessions tick to observe it gone. Tombstone the id first so
  // a poll whose listSessions() was already in flight can't re-add it (reconcile).
  const dropSession = useCallback((sessionId: string) => {
    removedIds.current.add(sessionId)
    setSessions((prev) => removeSessionFromState(prev, sessionId))
  }, [])

  useEffect(() => {
    void refreshAll()
    const interval = setInterval(() => void refreshSessions(), SESSION_STATUS_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
    // Only ever set up once - refreshAll/refreshSessions are stable (their only
    // dep, reconcile, is itself a no-dep useCallback, so their identity never changes).
  }, [])

  return { projects, sessions, refreshAll, refreshSessions, applySession, dropSession, loadError }
}
