import type { FileDiff, PendingPrompt, Project, SessionStatus, TranscriptMessage } from '../../shared/ipc-contract'

export type {
  FileDiff,
  FileDiffStatus,
  MergeMode,
  MergeResult,
  PendingPrompt,
  PendingPromptType,
  SessionStatus,
  TranscriptMessage
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
  // The CLI's own session id (as it names the on-disk transcript file). The
  // Engine records it so getTranscript can locate a spawned session's
  // transcript later, even once the session is terminal and the CLI has
  // dropped it from `claude agents`.
  cliSessionId: string
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
  // The CLI's own session id (the name of its on-disk transcript file) - lets
  // the Engine read a discovered/adopted session's transcript, the same way a
  // spawned one's ProcessInfo.cliSessionId does. The real adapter always
  // resolves it (it's the same id scan/resolveManual already key off);
  // optional only so a Session without a transcript to read is still
  // expressible, and the Engine simply has no transcript to fetch for it.
  cliSessionId?: string
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
  // Reads a session's full message history from its on-disk transcript, keyed
  // by the CLI session id (ProcessInfo/DiscoveredSession.cliSessionId). Works
  // for any session with a transcript on disk - spawned, discovered, or
  // adopted, running or terminal. Returns [] when the transcript can't be
  // found or read (never throws), so a missing/locked file just yields an
  // empty history rather than failing getTranscript.
  readTranscript(cliSessionId: string): Promise<TranscriptMessage[]>
}

export interface EngineAdapters {
  persistence: PersistenceAdapter
  git: GitAdapter
  process: ProcessAdapter
  notification: NotificationAdapter
  github: GitHubAdapter
  discovery: DiscoveryAdapter
}
