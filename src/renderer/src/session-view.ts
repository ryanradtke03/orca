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
  'idle',
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

const SHORT_MERGE_MODE_LABELS: Record<MergeMode, string> = {
  manual: 'manual',
  'local-merge': 'local',
  'pull-request': 'PR'
}

/** The compact merge-mode tag a Home group header shows, e.g. "merge: PR". */
export function shortMergeMode(mergeMode: MergeMode): string {
  return SHORT_MERGE_MODE_LABELS[mergeMode]
}

/**
 * Optional per-Session presentation fields the mock backend rides along on a
 * Session and live mode omits (ticket #49's placeholder types). Home reads
 * them for its diff-stat column and "Needs you" cards; every one is optional so
 * a real-IPC Session renders degraded, never broken.
 */
export interface SessionDisplay {
  additions?: number
  deletions?: number
  fileCount?: number
  /** Free-text note the "Needs you" card shows, e.g. "waiting on your reply for 6m". */
  attentionNote?: string
}

/** A Session as the Home screen renders it - the contract shape plus the optional display fields above. */
export type HomeSession = Session & SessionDisplay

/**
 * The right-hand diff-stat column on a Home row, e.g. "+412 −86 · 9 files".
 * Empty when the counts are absent (live mode); "no changes" when the Session
 * has touched nothing yet.
 */
export function formatDiffStat({ additions, deletions, fileCount }: HomeSession): string {
  if (additions === undefined && deletions === undefined && fileCount === undefined) return ''
  const add = additions ?? 0
  const del = deletions ?? 0
  const files = fileCount ?? 0
  if (add === 0 && del === 0 && files === 0) return 'no changes'
  return `+${add} −${del} · ${files} ${files === 1 ? 'file' : 'files'}`
}

export type SessionActionKind = 'stop' | 'review' | 'log'

export interface SessionAction {
  kind: SessionActionKind
  label: string
}

/**
 * The single contextual action a Home row offers, driven by status: Review a
 * finished Session's diff, read the Log of one that stopped or errored, or Stop
 * one still alive. A done Session whose worktree has already been reclaimed
 * (merged / discarded) has no diff left to review, so it falls back to Log
 * rather than offering a Review that would fail in getDiff.
 */
export function contextualActionFor(session: HomeSession): SessionAction {
  const { status } = session
  if (status === 'done') {
    return canViewDiff(session) ? { kind: 'review', label: 'Review' } : { kind: 'log', label: 'Log' }
  }
  if (status === 'errored' || status === 'stopped') return { kind: 'log', label: 'Log' }
  return { kind: 'stop', label: 'Stop' }
}

export type NeedsYouSummary =
  | { kind: 'permission'; command: string }
  | { kind: 'input'; text: string }

/**
 * What a "Needs you" card says about a waiting Session: the command a
 * permission prompt wants to run (pulled out of its `Tool(command)` text), or
 * the prose an input prompt is waiting on.
 */
export function describeNeedsYou(session: HomeSession): NeedsYouSummary {
  const prompt = session.pendingPrompt
  const firstLine = (text: string): string => text.split('\n', 1)[0]?.trim() ?? ''
  if (prompt?.type === 'permission') {
    const line = firstLine(prompt.text)
    // Only treat the text as a tool call when the line is shaped like
    // `Tool(command)` - an identifier immediately followed by parentheses.
    // The greedy capture spans nested parens; prose that merely contains
    // parentheses ("Allow write (see plan)?") doesn't match and falls back to
    // showing the whole line.
    const command = /^[A-Za-z]\w*\((.*)\)/.exec(line)?.[1]
    return { kind: 'permission', command: command ?? line }
  }
  return { kind: 'input', text: session.attentionNote ?? (prompt ? firstLine(prompt.text) : '') }
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
