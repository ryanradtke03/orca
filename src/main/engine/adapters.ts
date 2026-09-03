import type { FileDiff, PendingPrompt, Project } from '../../shared/ipc-contract'

export type { FileDiff, FileDiffStatus, PendingPrompt, PendingPromptType } from '../../shared/ipc-contract'

export interface PersistenceAdapter {
  loadSessionCount(): Promise<number>
  loadProjects(): Promise<Project[]>
  saveProjects(projects: Project[]): Promise<void>
}

export interface WorktreeInfo {
  worktreePath: string
  branch: string
  // The commit the worktree's branch forked from - lets getDiff show
  // everything a Session has changed regardless of whether it committed.
  baseRef: string
}

export interface GitAdapter {
  createWorktree(projectPath: string): Promise<WorktreeInfo>
  removeWorktree(projectPath: string, worktreePath: string): Promise<void>
  getDiff(worktreePath: string, baseRef: string): Promise<FileDiff[]>
}

export interface ProcessInfo {
  pid: number
}

export interface ProcessAdapter {
  spawnClaude(cwd: string): Promise<ProcessInfo>
  stop(pid: number): Promise<void>
  isAlive(pid: number): boolean
  exitCode(pid: number): number | null
  pendingPrompt(pid: number): PendingPrompt | null
  respond(pid: number, response: string): Promise<void>
}

export type NotificationUrgency = 'critical' | 'low'

export interface Notification {
  title: string
  body: string
  urgency: NotificationUrgency
}

export interface NotificationAdapter {
  notify(notification: Notification): void
}

export interface EngineAdapters {
  persistence: PersistenceAdapter
  git: GitAdapter
  process: ProcessAdapter
  notification: NotificationAdapter
}
