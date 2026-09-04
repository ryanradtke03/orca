import type { MergeMode, Project, Session, SessionStatus } from '../../shared/ipc-contract'

const STATUS_LABELS: Record<SessionStatus, string> = {
  running: 'Running',
  'waiting-on-permission': 'Waiting · permission',
  'waiting-on-input': 'Waiting · input',
  idle: 'Idle',
  done: 'Done',
  errored: 'Errored',
  stopped: 'Stopped'
}

export function describeStatus(status: SessionStatus): string {
  return STATUS_LABELS[status]
}

export const STOPPABLE_STATUSES: ReadonlySet<SessionStatus> = new Set([
  'running',
  'waiting-on-permission',
  'waiting-on-input'
])

export function isStoppable(status: SessionStatus): boolean {
  return STOPPABLE_STATUSES.has(status)
}

export function isAttentionStatus(status: SessionStatus): boolean {
  return status === 'waiting-on-permission' || status === 'waiting-on-input'
}

export function isTerminalStatus(status: SessionStatus): boolean {
  return status === 'done' || status === 'errored' || status === 'stopped'
}

// Mirrors the Engine's RESPONDABLE_STATUSES for idle/waiting-on-input
// specifically - the always-available message input only ever shows for
// those two. waiting-on-permission can also receive a message engine-side,
// but that status renders approve/deny actions instead (see prompt-view.ts).
const MESSAGE_SENDABLE_STATUSES: ReadonlySet<SessionStatus> = new Set(['idle', 'waiting-on-input'])

export function canSendMessage(status: SessionStatus): boolean {
  return MESSAGE_SENDABLE_STATUSES.has(status)
}

// A finished (successfully done) Session is the only one offered for merge -
// there's nothing worth integrating from one that was stopped or errored.
export function isMergeable(status: SessionStatus): boolean {
  return status === 'done'
}

// Once a Session's worktree is gone (merge-mode cleanup or an explicit
// discard), there's no Diff or worktree left for a "Request merge"/"Diff"
// action to operate on.
export function canRequestMerge(session: Session): boolean {
  return isMergeable(session.status) && !session.worktreeRemoved
}

export function canViewDiff(session: Session): boolean {
  return !session.worktreeRemoved
}

// A terminal Session with its worktree still on disk can be explicitly
// discarded - the only way to reclaim a Manual-mode Session's worktree
// short of the user merging it themselves, and the only way at all for one
// that was stopped or errored (Merge mode never applies to those).
export function canDiscardWorktree(session: Session): boolean {
  return isTerminalStatus(session.status) && !session.worktreeRemoved
}

export const MERGE_MODES: MergeMode[] = ['manual', 'local-merge', 'pull-request']

const MERGE_MODE_LABELS: Record<MergeMode, string> = {
  manual: 'Manual',
  'local-merge': 'Local merge',
  'pull-request': 'Pull request'
}

export function describeMergeMode(mergeMode: MergeMode): string {
  return MERGE_MODE_LABELS[mergeMode]
}

type SummaryBucket = 'running' | 'waiting' | 'idle' | 'done' | 'errored' | 'stopped'

const SUMMARY_BUCKET_ORDER: SummaryBucket[] = ['running', 'waiting', 'idle', 'done', 'errored', 'stopped']

function bucketFor(status: SessionStatus): SummaryBucket {
  if (status === 'waiting-on-permission' || status === 'waiting-on-input') return 'waiting'
  return status
}

/** Header stats line, e.g. "3 running · 2 waiting · 2 done" — zero-count buckets are omitted. */
export function summarizeStatuses(sessions: Session[]): string {
  const counts = new Map<SummaryBucket, number>()
  for (const session of sessions) {
    const bucket = bucketFor(session.status)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }

  return SUMMARY_BUCKET_ORDER.filter((bucket) => counts.has(bucket))
    .map((bucket) => `${counts.get(bucket)} ${bucket}`)
    .join(' · ')
}

export interface ProjectSessionGroup {
  project: Project
  sessions: Session[]
}

export function groupSessionsByProject(projects: Project[], sessions: Session[]): ProjectSessionGroup[] {
  return projects.map((project) => ({
    project,
    sessions: sessions.filter((session) => session.projectId === project.id)
  }))
}

export function needsAttentionSessions(sessions: Session[]): Session[] {
  return sessions.filter((session) => session.pendingPrompt !== undefined)
}
