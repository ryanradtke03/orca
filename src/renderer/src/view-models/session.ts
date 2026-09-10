import type { FileDiff, MergeMode, Project, Session, SessionStatus } from '../../../shared/ipc-contract'
import type { TranscriptEntry } from './transcript'

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

const STATUS_PHRASES: Record<SessionStatus, string> = {
  running: 'running',
  'waiting-on-permission': 'waiting on permission',
  'waiting-on-input': 'waiting on input',
  idle: 'idle',
  done: 'done',
  errored: 'errored',
  stopped: 'stopped'
}

/** The lowercase natural phrase the session header shows, e.g. "waiting on permission". */
export function describeStatusPhrase(status: SessionStatus): string {
  return STATUS_PHRASES[status]
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

export type PlanStepState = 'done' | 'active' | 'pending'

export interface PlanStep {
  text: string
  state: PlanStepState
}

export interface QueuedPrompt {
  text: string
  /** The dashed sub-line the inspector shows, e.g. "sends after approval". */
  note?: string
}

/**
 * The richer per-Session fields the session screen (05b) shows on top of the
 * Home ones: model/token/turn metadata, the plan checklist, queued prompts,
 * the full transcript (incl. tool calls and the permission card), and a short
 * relative-activity label for the nav. Every one is optional so a live-mode
 * (real-IPC) Session renders degraded, never broken.
 */
export interface SessionDetail extends SessionDisplay {
  model?: string
  tokensUsed?: number
  tokenLimit?: number
  turns?: number
  plan?: PlanStep[]
  queuedPrompts?: QueuedPrompt[]
  transcript?: TranscriptEntry[]
  /** Short relative-activity label the session nav shows, e.g. "1m" or "31m". */
  activityLabel?: string
}

/** A Session as the session screen renders it - the contract shape plus the optional detail fields above. */
export type DetailSession = Session & SessionDetail

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

/**
 * Applies a single updated Session to a list, in place of the poll's ~2s
 * refresh: replaces the matching row by id, or appends it when new (a freshly
 * spawned/adopted Session). Returns a new array and never mutates the input, so
 * it drops straight into React state. The status poll reconciles anything this
 * optimistic update missed on its next tick.
 */
export function upsertSession(sessions: Session[], session: Session): Session[] {
  const index = sessions.findIndex((candidate) => candidate.id === session.id)
  if (index === -1) return [...sessions, session]
  const next = sessions.slice()
  next[index] = session
  return next
}

/**
 * Drops a removed Session from a list, in place of waiting for the poll's next
 * refresh to notice it's gone. Returns a new array and never mutates the input;
 * a no-op (returns the same reference) when the id isn't present.
 */
export function removeSessionFromState(sessions: Session[], sessionId: string): Session[] {
  if (!sessions.some((candidate) => candidate.id === sessionId)) return sessions
  return sessions.filter((candidate) => candidate.id !== sessionId)
}

/**
 * Whether removing this Session will discard a worktree from disk - true
 * whenever one is still there. Drives the Remove confirmation: a worktree
 * discard is destructive (it can throw away unreviewed/unmerged work) and must
 * be confirmed, whereas removing a Session whose worktree is already gone only
 * forgets a record.
 */
export function removalDiscardsWorktree(session: Session): boolean {
  return !session.worktreeRemoved
}

// --- Session screen (05b) helpers ------------------------------------------

export interface NavBuckets {
  /** Anything paused on a prompt, across every project (triage first) - current project's own listed ahead of others. */
  needsYou: DetailSession[]
  /** The current project's live, unblocked sessions (running / idle). */
  active: DetailSession[]
  /** The current project's finished sessions (done / errored / stopped). */
  recent: DetailSession[]
}

/**
 * Splits sessions into the session nav's three groups relative to the open
 * session's project. "Needs you" spans all projects so nothing waiting is
 * hidden; the other two are scoped to the current project. Needs-you keeps
 * the current project's sessions ahead of other projects', but is otherwise
 * stable in the given order.
 */
export function bucketSessionsForNav(sessions: DetailSession[], currentProjectId: string): NavBuckets {
  const needsYou = sessions
    .filter((session) => session.pendingPrompt !== undefined)
    .sort((a, b) => Number(b.projectId === currentProjectId) - Number(a.projectId === currentProjectId))
  const active = sessions.filter(
    (session) =>
      session.projectId === currentProjectId &&
      session.pendingPrompt === undefined &&
      !isTerminalStatus(session.status)
  )
  const recent = sessions.filter(
    (session) => session.projectId === currentProjectId && isTerminalStatus(session.status)
  )
  return { needsYou, active, recent }
}

/**
 * The sub-line a session nav row shows under its name. A waiting or active
 * session shows its state and (if known) how long it's been there; a finished
 * one shows its diff stat instead. A nav row for a session in another project
 * than the open one gets that project's name appended.
 */
export function describeNavDetail(session: DetailSession, currentProjectId: string, projectName: string): string {
  const word = session.pendingPrompt?.type ?? session.status
  if (isTerminalStatus(session.status)) {
    const stat = formatNavDiff(session)
    return stat ? `${word} · ${stat}` : word
  }
  const age = session.activityLabel ? ` · ${session.activityLabel}` : ''
  const project = session.projectId === currentProjectId ? '' : ` · ${projectName}`
  return `${word}${age}${project}`
}

function formatNavDiff({ additions, deletions }: SessionDisplay): string {
  if (additions === undefined && deletions === undefined) return ''
  return `+${additions ?? 0} −${deletions ?? 0}`
}

/** Compacts a token count to a "k" figure, e.g. 128000 -> "128k"; counts under 1000 stay as-is. */
function compactTokens(count: number): string {
  return count >= 1000 ? `${Math.round(count / 1000)}k` : `${count}`
}

/**
 * The inspector's token line, e.g. "128k / 200k". Empty when neither figure is
 * known (live mode), so the row can be hidden rather than showing "? / ?".
 */
export function formatTokenUsage(used?: number, limit?: number): string {
  if (used === undefined || limit === undefined) return ''
  return `${compactTokens(used)} / ${compactTokens(limit)}`
}

export interface FilesTouchedRow {
  path: string
  additions: number
}

export interface FilesTouchedSummary {
  totalAdditions: number
  totalDeletions: number
  /** The first few files, shown individually. */
  rows: FilesTouchedRow[]
  /** How many touched files aren't shown as their own row (0 when all fit). */
  moreCount: number
  /** The additions those collapsed files account for. */
  moreAdditions: number
  /** False only when there's nothing touched at all - lets the caller show an empty state. */
  hasChanges: boolean
}

const FILES_TOUCHED_ROW_LIMIT = 3

/**
 * Rolls the inspector's "Files touched" block up from the diff plus the
 * Session's own totals. The diff supplies the individual file rows; the
 * Session's rolled-up counts (present in mock mode) supply the header totals
 * and let a "N more" row stand in for files beyond the diff sample. In live
 * mode those counts are absent, so totals fall back to summing the diff and
 * nothing is collapsed.
 */
export function summarizeFilesTouched(files: FileDiff[], meta: SessionDisplay): FilesTouchedSummary {
  const sum = (pick: (file: FileDiff) => number): number => files.reduce((total, file) => total + pick(file), 0)
  const totalAdditions = meta.additions ?? sum((file) => file.additions)
  const totalDeletions = meta.deletions ?? sum((file) => file.deletions)
  const totalFiles = meta.fileCount ?? files.length

  const rows = files.slice(0, FILES_TOUCHED_ROW_LIMIT).map((file) => ({ path: file.path, additions: file.additions }))
  const shownAdditions = rows.reduce((total, row) => total + row.additions, 0)
  const moreCount = Math.max(0, totalFiles - rows.length)

  return {
    totalAdditions,
    totalDeletions,
    rows,
    moreCount,
    moreAdditions: Math.max(0, totalAdditions - shownAdditions),
    hasChanges: totalFiles > 0 || files.length > 0
  }
}
