import type { FileDiff, PendingPrompt, Project, SessionStatus } from '../../shared/ipc-contract'

export type {
  FileDiff,
  FileDiffStatus,
  MergeMode,
  MergeResult,
  PendingPrompt,
  PendingPromptType,
  SessionStatus
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
  // Removes a worktree regardless of uncommitted/untracked changes, for an
  // explicit user discard - unlike removeWorktree, which git itself refuses
  // in that situation so unreviewed work isn't lost silently.
  discardWorktree(projectPath: string, worktreePath: string): Promise<void>
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

export type PullRequestStatus = 'open' | 'merged' | 'closed'

export interface GitHubAdapter {
  openPullRequest(params: {
    projectPath: string
    branch: string
    title: string
  }): Promise<PullRequestInfo>
  getPullRequestStatus(url: string): Promise<PullRequestStatus>
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
  // Registers a pid this adapter didn't spawn itself - found running
  // independently via Discovery or a manual Adopt - so isAlive/exitCode/
  // pendingPrompt track it from here on exactly like a spawned session's.
  // Rejects if pid doesn't correspond to a session this adapter can confirm
  // is actually running.
  registerAlive(pid: number): Promise<void>
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

export interface DiscoveredSession {
  // Same identity space as ProcessAdapter's pid-keyed methods, so once the
  // Engine adopts a discovered session it can be polled by
  // refreshSessionStatuses exactly like a spawned one.
  pid: number
  // The directory the session is actually running in - becomes the
  // Session's worktreePath, whether or not it's an Orca-managed worktree.
  cwd: string
  // The repo root cwd sits inside. Used to match an existing Project (by
  // path) or create a new one - never the worktree/cwd itself, since a
  // spawned Session's cwd is a worktree path, not the Project's own path.
  projectPath: string
  branch: string
  // What getDiff should compare cwd's working tree against. For a session
  // Orca didn't spawn there's no recorded fork point, so an adapter is
  // expected to make a best-effort choice (e.g. a merge-base with the
  // Project's default branch).
  baseRef: string
  status: SessionStatus
  pendingPrompt?: PendingPrompt
}

export interface DiscoveryAdapter {
  // Lists every Claude Code CLI session currently running, whether Orca
  // already tracks it or not - the Engine is responsible for filtering out
  // ones it already knows about (see Engine.discoverSessions).
  scan(): Promise<DiscoveredSession[]>
  // Resolves a single session the user has manually pointed Orca at by pid
  // and working directory (Adopt) - for a session scan() can't find or fully
  // resolve on its own, e.g. because it isn't listed by `claude agents`, or
  // its transcript's cwd couldn't be read. Unlike scan(), which discovers cwd
  // itself, the caller-supplied directory is authoritative here. Returns null
  // when pid doesn't correspond to a running Claude Code session.
  resolveManual(pid: number, directory: string): Promise<DiscoveredSession | null>
}

export interface EngineAdapters {
  persistence: PersistenceAdapter
  git: GitAdapter
  process: ProcessAdapter
  notification: NotificationAdapter
  github: GitHubAdapter
  discovery: DiscoveryAdapter
}
