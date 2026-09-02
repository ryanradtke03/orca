export interface PingResult {
  ok: true
  sessionCount: number
}

export interface Project {
  id: string
  path: string
  name: string
}

export type SessionStatus =
  | 'running'
  | 'waiting-on-permission'
  | 'waiting-on-input'
  | 'idle'
  | 'done'
  | 'errored'
  | 'stopped'

export type PendingPromptType = 'permission' | 'input'

export interface PendingPrompt {
  type: PendingPromptType
  text: string
}

export interface Session {
  id: string
  projectId: string
  worktreePath: string
  branch: string
  pid: number
  status: SessionStatus
  pendingPrompt?: PendingPrompt
}

export const IPC_CHANNELS = {
  ping: 'engine:ping',
  listProjects: 'project:list',
  addProjectViaDialog: 'project:add-via-dialog',
  spawnSession: 'session:spawn',
  listSessions: 'session:list',
  refreshSessionStatuses: 'session:refresh-statuses',
  stopSession: 'session:stop',
  respondToPrompt: 'session:respond-to-prompt'
} as const

export interface OrcaApi {
  ping(): Promise<PingResult>
  listProjects(): Promise<Project[]>
  addProjectViaDialog(): Promise<Project | null>
  spawnSession(projectId: string): Promise<Session>
  listSessions(): Promise<Session[]>
  refreshSessionStatuses(): Promise<Session[]>
  stopSession(sessionId: string): Promise<Session>
  respondToPrompt(sessionId: string, response: string): Promise<Session>
}
