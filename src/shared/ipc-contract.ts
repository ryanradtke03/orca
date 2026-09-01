export interface PingResult {
  ok: true
  sessionCount: number
}

export interface Project {
  id: string
  path: string
  name: string
}

export interface Session {
  id: string
  projectId: string
  worktreePath: string
  branch: string
  pid: number
}

export const IPC_CHANNELS = {
  ping: 'engine:ping',
  listProjects: 'project:list',
  addProjectViaDialog: 'project:add-via-dialog',
  spawnSession: 'session:spawn',
  listSessions: 'session:list'
} as const

export interface OrcaApi {
  ping(): Promise<PingResult>
  listProjects(): Promise<Project[]>
  addProjectViaDialog(): Promise<Project | null>
  spawnSession(projectId: string): Promise<Session>
  listSessions(): Promise<Session[]>
}
