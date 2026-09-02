export interface PingResult {
  ok: true
  sessionCount: number
}

export interface Project {
  id: string
  path: string
  name: string
}

export type SessionStatus = 'running' | 'idle' | 'done' | 'errored'

export interface Session {
  id: string
  projectId: string
  worktreePath: string
  branch: string
  pid: number
  status: SessionStatus
}

export const IPC_CHANNELS = {
  ping: 'engine:ping',
  listProjects: 'project:list',
  addProjectViaDialog: 'project:add-via-dialog',
  spawnSession: 'session:spawn',
  listSessions: 'session:list',
  refreshSessionStatuses: 'session:refresh-statuses'
} as const

export interface OrcaApi {
  ping(): Promise<PingResult>
  listProjects(): Promise<Project[]>
  addProjectViaDialog(): Promise<Project | null>
  spawnSession(projectId: string): Promise<Session>
  listSessions(): Promise<Session[]>
  refreshSessionStatuses(): Promise<Session[]>
}
