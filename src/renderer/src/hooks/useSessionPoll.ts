import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project, Session } from '../../../shared/ipc-contract'
import { describeError } from '../describe-error'

const SESSION_STATUS_POLL_INTERVAL_MS = 2000

export interface SessionPoll {
  projects: Project[]
  sessions: Session[]
  /** Re-fetches both projects and sessions - used after an action that can change either (add project, spawn, adopt, set merge mode). */
  refreshAll: () => Promise<void>
  /** Re-fetches sessions only - used after an action that only changes session state (stop, respond, merge, discard). */
  refreshSessions: () => Promise<void>
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
      const [nextProjects, nextSessions] = await Promise.all([window.orca.listProjects(), window.orca.listSessions()])
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
      const nextSessions = await window.orca.listSessions()
      if (token !== sessionsToken.current) return
      setSessions(nextSessions)
      setLoadError('')
    } catch (error) {
      if (token !== sessionsToken.current) return
      setLoadError(`Failed to refresh session statuses: ${describeError(error)}`)
    }
  }, [])

  useEffect(() => {
    void refreshAll()
    const interval = setInterval(() => void refreshSessions(), SESSION_STATUS_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
    // Only ever set up once - refreshAll/refreshSessions are stable (useCallback with no deps).
  }, [])

  return { projects, sessions, refreshAll, refreshSessions, loadError }
}
