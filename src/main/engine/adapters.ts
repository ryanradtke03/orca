import type { FileDiff, PendingPrompt, Project } from '../../shared/ipc-contract'

export type {
  FileDiff,
  FileDiffStatus,
  MergeMode,
  MergeResult,
  PendingPrompt,
  PendingPromptType
} from '../../shared/ipc-contract'

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
  // Commits any changes still uncommitted in the worktree (the Diff shows
  // those too, so leaving them behind would merge less than the user
  // reviewed), then merges the branch back into whatever's checked out at
  // projectPath.
  mergeWorktree(params: { projectPath: string; worktreePath: string; branch: string }): Promise<void>
  // Commits any changes still uncommitted in the worktree, then pushes the
  // branch to its remote so a pull request can be opened from it.
  pushBranch(worktreePath: string, branch: string): Promise<void>
}

export interface PullRequestInfo {
  url: string
}

export interface GitHubAdapter {
  openPullRequest(params: {
    projectPath: string
    branch: string
    title: string
  }): Promise<PullRequestInfo>
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
  github: GitHubAdapter
}
