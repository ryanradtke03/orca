export interface PingResult {
  ok: true
  sessionCount: number
}

export type MergeMode = 'manual' | 'local-merge' | 'pull-request'

export interface Project {
  id: string
  path: string
  name: string
  mergeMode: MergeMode
}

export interface MergeResult {
  mergeMode: MergeMode
  pullRequestUrl?: string
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
  // The commit the worktree's branch forked from - what its Diff is compared against.
  baseRef: string
  pid: number
  status: SessionStatus
  pendingPrompt?: PendingPrompt
  // Set once the Session's worktree has actually been removed from disk -
  // either merge-mode-integrated cleanup or an explicit user discard. A
  // Session in this state has no Diff or worktree path left to operate on.
  worktreeRemoved?: boolean
  // Set when Merge mode = Pull request has opened a PR for this Session -
  // refreshSessionStatuses polls it and reclaims the worktree once merged.
  pullRequestUrl?: string
}

export type TranscriptRole = 'user' | 'assistant'

export interface TranscriptMessage {
  id: string
  role: TranscriptRole
  text: string
  timestamp: number
}

export type FileDiffStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface FileDiff {
  path: string
  status: FileDiffStatus
  additions: number
  deletions: number
  diffText: string
}

export const IPC_CHANNELS = {
  ping: 'engine:ping',
  listProjects: 'project:list',
  addProjectViaDialog: 'project:add-via-dialog',
  spawnSession: 'session:spawn',
  listSessions: 'session:list',
  refreshSessionStatuses: 'session:refresh-statuses',
  stopSession: 'session:stop',
  respondToPrompt: 'session:respond-to-prompt',
  getDiff: 'session:get-diff',
  getTranscript: 'session:get-transcript',
  setProjectMergeMode: 'project:set-merge-mode',
  requestMerge: 'session:request-merge',
  discardWorktree: 'session:discard-worktree',
  adoptSession: 'session:adopt'
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
  getDiff(sessionId: string): Promise<FileDiff[]>
  getTranscript(sessionId: string): Promise<TranscriptMessage[]>
  setProjectMergeMode(projectId: string, mergeMode: MergeMode): Promise<Project>
  requestMerge(sessionId: string): Promise<MergeResult>
  discardWorktree(sessionId: string): Promise<Session>
  adoptSession(pid: number, directory: string): Promise<Session>
}
