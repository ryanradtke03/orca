import { create } from 'zustand'
import type { Session, SessionStatus } from '@shared/domain'

/**
 * Renderer mirror of the sessions that main owns. Hydrated from `listSessions`
 * and kept in sync by IPC events (see App bootstrap / useTerminalIpc).
 */
interface SessionState {
  sessions: Record<string, Session>
  upsert: (session: Session) => void
  setStatus: (id: string, status: SessionStatus) => void
  remove: (id: string) => void
  hydrate: (sessions: Session[]) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: {},
  upsert: (session) =>
    set((s) => ({ sessions: { ...s.sessions, [session.id]: session } })),
  setStatus: (id, status) =>
    set((s) =>
      s.sessions[id] ? { sessions: { ...s.sessions, [id]: { ...s.sessions[id], status } } } : s
    ),
  remove: (id) =>
    set((s) => {
      const next = { ...s.sessions }
      delete next[id]
      return { sessions: next }
    }),
  hydrate: (sessions) =>
    set({ sessions: Object.fromEntries(sessions.map((s) => [s.id, s])) })
}))

/** Convenience selector: sessions as an array. */
export const selectSessionList = (s: SessionState): Session[] => Object.values(s.sessions)
