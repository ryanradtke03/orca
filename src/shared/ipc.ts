import type { Project, Session, SessionStatus } from './domain'

/**
 * IPC channel names. Grouped by direction:
 *   invoke/handle  = request/response (renderer asks, main answers once)
 *   send           = fire-and-forget, high-frequency (keystrokes, resize)
 *   event          = main -> renderer streams (pty output, status changes)
 */
export const IpcChannel = {
  // renderer -> main (invoke)
  SpawnSession: 'session:spawn',
  KillSession: 'session:kill',
  ListSessions: 'session:list',
  ListProjects: 'projects:list',
  SaveProject: 'projects:save',

  // renderer -> main (send, high-frequency)
  WriteSession: 'session:write',
  ResizeSession: 'session:resize',

  // main -> renderer (events)
  SessionData: 'session:data',
  SessionStatus: 'session:status',
  SessionExit: 'session:exit'
} as const

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel]

/* ---- payloads ---- */

export interface SpawnSessionRequest {
  projectId: string
  cwd: string
  shell?: string
  cols: number
  rows: number
}

export interface WriteSessionRequest {
  sessionId: string
  data: string
}

export interface ResizeSessionRequest {
  sessionId: string
  cols: number
  rows: number
}

export interface SessionDataEvent {
  sessionId: string
  data: string
}

export interface SessionStatusEvent {
  sessionId: string
  status: SessionStatus
}

export interface SessionExitEvent {
  sessionId: string
  exitCode: number
  signal?: number
}

/**
 * The typed surface the preload bridge exposes on `window.api`.
 * Both the preload implementation and the renderer's `lib/ipc.ts` are typed
 * against this, so the boundary can't drift.
 *
 * The `on*` methods return an unsubscribe function (call it on cleanup).
 */
export interface OrcaApi {
  spawnSession(req: SpawnSessionRequest): Promise<Session>
  killSession(sessionId: string): Promise<void>
  listSessions(): Promise<Session[]>
  listProjects(): Promise<Project[]>
  saveProject(project: Project): Promise<void>

  writeSession(req: WriteSessionRequest): void
  resizeSession(req: ResizeSessionRequest): void

  onSessionData(cb: (e: SessionDataEvent) => void): () => void
  onSessionStatus(cb: (e: SessionStatusEvent) => void): () => void
  onSessionExit(cb: (e: SessionExitEvent) => void): () => void
}
