export interface PingResult {
  ok: true
  sessionCount: number
}

export interface Project {
  id: string
  path: string
  name: string
}

export const IPC_CHANNELS = {
  ping: 'engine:ping',
  listProjects: 'project:list',
  addProjectViaDialog: 'project:add-via-dialog'
} as const

export interface OrcaApi {
  ping(): Promise<PingResult>
  listProjects(): Promise<Project[]>
  addProjectViaDialog(): Promise<Project | null>
}
