import { describe, expect, it } from 'vitest'
import type { Project, Session } from '../../../shared/ipc-contract'
import {
  bucketSessionsForNav,
  canDiscardWorktree,
  canRequestMerge,
  canSendMessage,
  canViewDiff,
  contextualActionFor,
  describeMergeMode,
  describeNavDetail,
  describeNeedsYou,
  describeStatus,
  describeStatusPhrase,
  type DetailSession,
  formatDiffStat,
  formatTokenUsage,
  groupSessionsByProject,
  type HomeSession,
  isAttentionStatus,
  isMergeable,
  isStoppable,
  isTerminalStatus,
  MERGE_MODES,
  needsAttentionSessions,
  removalDiscardsWorktree,
  removeSessionFromState,
  shortMergeMode,
  summarizeFilesTouched,
  summarizeStatuses,
  upsertSession
} from './session'
import type { FileDiff } from '../../../shared/ipc-contract'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    projectId: 'project-1',
    worktreePath: '/tmp/session-1',
    branch: 'orca/session-1',
    baseRef: 'abc123',
    pid: 1,
    status: 'running',
    ...overrides
  }
}

function makeDetail(overrides: Partial<DetailSession> = {}): DetailSession {
  return { ...makeSession(), ...overrides }
}

describe('describeStatus', () => {
  it('labels each status', () => {
    expect(describeStatus('running')).toBe('Running')
    expect(describeStatus('waiting-on-permission')).toBe('Waiting · permission')
    expect(describeStatus('waiting-on-input')).toBe('Waiting · input')
    expect(describeStatus('idle')).toBe('Idle')
    expect(describeStatus('done')).toBe('Done')
    expect(describeStatus('errored')).toBe('Errored')
    expect(describeStatus('stopped')).toBe('Stopped')
  })
})

describe('summarizeStatuses', () => {
  it('returns an empty string for no sessions', () => {
    expect(summarizeStatuses([])).toBe('')
  })

  it('combines waiting-on-permission and waiting-on-input into one "waiting" bucket', () => {
    const sessions = [
      makeSession({ status: 'running' }),
      makeSession({ status: 'running' }),
      makeSession({ status: 'waiting-on-permission' }),
      makeSession({ status: 'waiting-on-input' }),
      makeSession({ status: 'done' }),
      makeSession({ status: 'done' })
    ]
    expect(summarizeStatuses(sessions)).toBe('2 running · 2 waiting · 2 done')
  })

  it('omits statuses with zero sessions and keeps a fixed order', () => {
    const sessions = [makeSession({ status: 'errored' }), makeSession({ status: 'idle' })]
    expect(summarizeStatuses(sessions)).toBe('1 idle · 1 errored')
  })

  it('uses singular-agnostic counts (just the number) for a single session', () => {
    expect(summarizeStatuses([makeSession({ status: 'stopped' })])).toBe('1 stopped')
  })
})

describe('groupSessionsByProject', () => {
  const projects: Project[] = [
    { id: 'p1', path: '/code/p1', name: 'orca', mergeMode: 'manual' },
    { id: 'p2', path: '/code/p2', name: 'atlas-api', mergeMode: 'manual' }
  ]

  it('returns one group per project, in project order, even with no sessions', () => {
    const groups = groupSessionsByProject(projects, [])
    expect(groups).toEqual([
      { project: projects[0], sessions: [] },
      { project: projects[1], sessions: [] }
    ])
  })

  it('buckets sessions under their project and preserves session order', () => {
    const s1 = makeSession({ id: 's1', projectId: 'p2' })
    const s2 = makeSession({ id: 's2', projectId: 'p1' })
    const s3 = makeSession({ id: 's3', projectId: 'p1' })
    const groups = groupSessionsByProject(projects, [s1, s2, s3])
    expect(groups[0]).toEqual({ project: projects[0], sessions: [s2, s3] })
    expect(groups[1]).toEqual({ project: projects[1], sessions: [s1] })
  })
})

describe('isStoppable', () => {
  it('allows stopping any session whose process is still expected to be alive', () => {
    expect(isStoppable('running')).toBe(true)
    expect(isStoppable('idle')).toBe(true)
    expect(isStoppable('waiting-on-permission')).toBe(true)
    expect(isStoppable('waiting-on-input')).toBe(true)
    expect(isStoppable('done')).toBe(false)
    expect(isStoppable('errored')).toBe(false)
    expect(isStoppable('stopped')).toBe(false)
  })
})

describe('isAttentionStatus', () => {
  it('is true only for the two waiting statuses', () => {
    expect(isAttentionStatus('waiting-on-permission')).toBe(true)
    expect(isAttentionStatus('waiting-on-input')).toBe(true)
    expect(isAttentionStatus('running')).toBe(false)
    expect(isAttentionStatus('idle')).toBe(false)
    expect(isAttentionStatus('done')).toBe(false)
    expect(isAttentionStatus('errored')).toBe(false)
    expect(isAttentionStatus('stopped')).toBe(false)
  })
})

describe('canSendMessage', () => {
  it('is true for idle and waiting-on-input, where the always-available message input is shown', () => {
    expect(canSendMessage('idle')).toBe(true)
    expect(canSendMessage('waiting-on-input')).toBe(true)
  })

  it('is false while running - interjecting mid-task is out of scope', () => {
    expect(canSendMessage('running')).toBe(false)
  })

  it('is false for waiting-on-permission, which uses approve/deny instead', () => {
    expect(canSendMessage('waiting-on-permission')).toBe(false)
  })

  it('is false for every terminal status', () => {
    expect(canSendMessage('done')).toBe(false)
    expect(canSendMessage('errored')).toBe(false)
    expect(canSendMessage('stopped')).toBe(false)
  })
})

describe('isTerminalStatus', () => {
  it('is true for done, errored, and stopped', () => {
    expect(isTerminalStatus('done')).toBe(true)
    expect(isTerminalStatus('errored')).toBe(true)
    expect(isTerminalStatus('stopped')).toBe(true)
    expect(isTerminalStatus('running')).toBe(false)
    expect(isTerminalStatus('waiting-on-permission')).toBe(false)
    expect(isTerminalStatus('waiting-on-input')).toBe(false)
    expect(isTerminalStatus('idle')).toBe(false)
  })
})

describe('isMergeable', () => {
  it('is true only for done', () => {
    expect(isMergeable('done')).toBe(true)
    expect(isMergeable('errored')).toBe(false)
    expect(isMergeable('stopped')).toBe(false)
    expect(isMergeable('running')).toBe(false)
    expect(isMergeable('waiting-on-permission')).toBe(false)
    expect(isMergeable('waiting-on-input')).toBe(false)
    expect(isMergeable('idle')).toBe(false)
  })
})

describe('canRequestMerge', () => {
  it('is true for a done session with its worktree still present', () => {
    expect(canRequestMerge(makeSession({ status: 'done' }))).toBe(true)
  })

  it('is false once the worktree has been removed', () => {
    expect(canRequestMerge(makeSession({ status: 'done', worktreeRemoved: true }))).toBe(false)
  })

  it('is false for a non-done session', () => {
    expect(canRequestMerge(makeSession({ status: 'errored' }))).toBe(false)
  })
})

describe('canViewDiff', () => {
  it('is true while the worktree is still present', () => {
    expect(canViewDiff(makeSession({ status: 'running' }))).toBe(true)
  })

  it('is false once the worktree has been removed', () => {
    expect(canViewDiff(makeSession({ status: 'done', worktreeRemoved: true }))).toBe(false)
  })
})

describe('canDiscardWorktree', () => {
  it('is true for a terminal session with its worktree still present', () => {
    expect(canDiscardWorktree(makeSession({ status: 'done' }))).toBe(true)
    expect(canDiscardWorktree(makeSession({ status: 'errored' }))).toBe(true)
    expect(canDiscardWorktree(makeSession({ status: 'stopped' }))).toBe(true)
  })

  it('is false for a session still running', () => {
    expect(canDiscardWorktree(makeSession({ status: 'running' }))).toBe(false)
    expect(canDiscardWorktree(makeSession({ status: 'waiting-on-permission' }))).toBe(false)
    expect(canDiscardWorktree(makeSession({ status: 'waiting-on-input' }))).toBe(false)
  })

  it('is false once the worktree has already been removed', () => {
    expect(canDiscardWorktree(makeSession({ status: 'done', worktreeRemoved: true }))).toBe(false)
  })
})

describe('describeMergeMode', () => {
  it('labels each merge mode', () => {
    expect(describeMergeMode('manual')).toBe('Manual')
    expect(describeMergeMode('local-merge')).toBe('Local merge')
    expect(describeMergeMode('pull-request')).toBe('Pull request')
  })

  it('has a label for every mode in MERGE_MODES', () => {
    for (const mode of MERGE_MODES) {
      expect(describeMergeMode(mode)).toEqual(expect.any(String))
    }
  })
})

describe('formatDiffStat', () => {
  it('is empty when no diff fields are present (live mode, richer fields absent)', () => {
    expect(formatDiffStat(makeSession())).toBe('')
  })

  it('reads "no changes" when the session has touched nothing', () => {
    expect(formatDiffStat({ ...makeSession(), additions: 0, deletions: 0, fileCount: 0 })).toBe('no changes')
  })

  it('formats additions, deletions, and a pluralized file count', () => {
    expect(formatDiffStat({ ...makeSession(), additions: 412, deletions: 86, fileCount: 9 })).toBe(
      '+412 −86 · 9 files'
    )
  })

  it('uses the singular "file" for a single file', () => {
    expect(formatDiffStat({ ...makeSession(), additions: 9, deletions: 0, fileCount: 1 })).toBe('+9 −0 · 1 file')
  })

  it('treats missing additions/deletions as zero when a file count is present', () => {
    expect(formatDiffStat({ ...makeSession(), fileCount: 2 })).toBe('+0 −0 · 2 files')
  })

  it('does not report "no changes" when additions/deletions are present but the file count is missing', () => {
    expect(formatDiffStat({ ...makeSession(), additions: 5, deletions: 2 })).toBe('+5 −2 · 0 files')
  })
})

describe('shortMergeMode', () => {
  it('abbreviates each merge mode for the group header', () => {
    expect(shortMergeMode('manual')).toBe('manual')
    expect(shortMergeMode('local-merge')).toBe('local')
    expect(shortMergeMode('pull-request')).toBe('PR')
  })

  it('has a short label for every mode in MERGE_MODES', () => {
    for (const mode of MERGE_MODES) {
      expect(shortMergeMode(mode)).toEqual(expect.any(String))
    }
  })
})

describe('contextualActionFor', () => {
  it('offers Review for a done session whose worktree is still present', () => {
    expect(contextualActionFor(makeSession({ status: 'done' }))).toEqual({ kind: 'review', label: 'Review' })
  })

  it('falls back to Log for a done session whose worktree has been reclaimed - there is no diff left to review', () => {
    expect(contextualActionFor(makeSession({ status: 'done', worktreeRemoved: true }))).toEqual({
      kind: 'log',
      label: 'Log'
    })
  })

  it('offers Log for terminal-but-unsuccessful sessions', () => {
    expect(contextualActionFor(makeSession({ status: 'errored' }))).toEqual({ kind: 'log', label: 'Log' })
    expect(contextualActionFor(makeSession({ status: 'stopped' }))).toEqual({ kind: 'log', label: 'Log' })
  })

  it('offers Stop for any session whose process is still expected to be alive', () => {
    expect(contextualActionFor(makeSession({ status: 'running' }))).toEqual({ kind: 'stop', label: 'Stop' })
    expect(contextualActionFor(makeSession({ status: 'idle' }))).toEqual({ kind: 'stop', label: 'Stop' })
    expect(contextualActionFor(makeSession({ status: 'waiting-on-permission' }))).toEqual({
      kind: 'stop',
      label: 'Stop'
    })
    expect(contextualActionFor(makeSession({ status: 'waiting-on-input' }))).toEqual({ kind: 'stop', label: 'Stop' })
  })
})

describe('describeNeedsYou', () => {
  function attentionSession(overrides: Partial<HomeSession>): HomeSession {
    return { ...makeSession(), ...overrides }
  }

  it('extracts the command from a permission prompt', () => {
    const session = attentionSession({
      status: 'waiting-on-permission',
      pendingPrompt: { type: 'permission', text: 'Bash(rm -rf out/)\n\nDo you want to proceed?' }
    })
    expect(describeNeedsYou(session)).toEqual({ kind: 'permission', command: 'rm -rf out/' })
  })

  it('falls back to the first line when a permission prompt has no parenthesized command', () => {
    const session = attentionSession({
      status: 'waiting-on-permission',
      pendingPrompt: { type: 'permission', text: 'Proceed with the risky step?\n\ndetails' }
    })
    expect(describeNeedsYou(session)).toEqual({ kind: 'permission', command: 'Proceed with the risky step?' })
  })

  it('keeps nested parentheses inside a tool call', () => {
    const session = attentionSession({
      status: 'waiting-on-permission',
      pendingPrompt: { type: 'permission', text: 'Bash(git commit -m "fix (typo)")' }
    })
    expect(describeNeedsYou(session)).toEqual({ kind: 'permission', command: 'git commit -m "fix (typo)"' })
  })

  it('does not mistake parenthetical prose for a command', () => {
    const session = attentionSession({
      status: 'waiting-on-permission',
      pendingPrompt: { type: 'permission', text: 'Allow write (see plan)?' }
    })
    expect(describeNeedsYou(session)).toEqual({ kind: 'permission', command: 'Allow write (see plan)?' })
  })

  it('prefers the attention note for an input prompt', () => {
    const session = attentionSession({
      status: 'waiting-on-input',
      pendingPrompt: { type: 'input', text: 'Which database?' },
      attentionNote: 'Asked a question — waiting on your reply for 6m'
    })
    expect(describeNeedsYou(session)).toEqual({
      kind: 'input',
      text: 'Asked a question — waiting on your reply for 6m'
    })
  })

  it('falls back to the prompt text for an input prompt with no attention note', () => {
    const session = attentionSession({
      status: 'waiting-on-input',
      pendingPrompt: { type: 'input', text: 'Which database?' }
    })
    expect(describeNeedsYou(session)).toEqual({ kind: 'input', text: 'Which database?' })
  })
})

describe('needsAttentionSessions', () => {
  it('returns only sessions with a pending prompt, preserving order', () => {
    const withPrompt = makeSession({ id: 'a', pendingPrompt: { type: 'permission', text: 'run rm -rf?' } })
    const withoutPrompt = makeSession({ id: 'b' })
    const anotherWithPrompt = makeSession({ id: 'c', pendingPrompt: { type: 'input', text: 'which env?' } })

    expect(needsAttentionSessions([withoutPrompt, withPrompt, anotherWithPrompt])).toEqual([
      withPrompt,
      anotherWithPrompt
    ])
  })

  it('returns an empty array when nothing needs attention', () => {
    expect(needsAttentionSessions([makeSession()])).toEqual([])
  })
})

describe('describeStatusPhrase', () => {
  it('gives a lowercase natural phrase for the header', () => {
    expect(describeStatusPhrase('waiting-on-permission')).toBe('waiting on permission')
    expect(describeStatusPhrase('waiting-on-input')).toBe('waiting on input')
    expect(describeStatusPhrase('running')).toBe('running')
    expect(describeStatusPhrase('done')).toBe('done')
  })
})

describe('formatTokenUsage', () => {
  it('compacts a used/limit pair to k figures', () => {
    expect(formatTokenUsage(128_000, 200_000)).toBe('128k / 200k')
  })

  it('leaves counts under 1000 as-is', () => {
    expect(formatTokenUsage(512, 200_000)).toBe('512 / 200k')
  })

  it('is empty when either figure is unknown (live mode)', () => {
    expect(formatTokenUsage(undefined, 200_000)).toBe('')
    expect(formatTokenUsage(128_000, undefined)).toBe('')
    expect(formatTokenUsage()).toBe('')
  })
})

describe('bucketSessionsForNav', () => {
  const permission = makeDetail({
    id: 'perm',
    projectId: 'proj-a',
    status: 'waiting-on-permission',
    pendingPrompt: { type: 'permission', text: 'Bash(x)' }
  })
  const inputOther = makeDetail({
    id: 'input',
    projectId: 'proj-b',
    status: 'waiting-on-input',
    pendingPrompt: { type: 'input', text: 'which?' }
  })
  const running = makeDetail({ id: 'run', projectId: 'proj-a', status: 'running' })
  const idle = makeDetail({ id: 'idle', projectId: 'proj-a', status: 'idle' })
  const otherActive = makeDetail({ id: 'other', projectId: 'proj-b', status: 'running' })
  const done = makeDetail({ id: 'done', projectId: 'proj-a', status: 'done' })

  const all = [inputOther, permission, running, idle, otherActive, done]
  const buckets = bucketSessionsForNav(all, 'proj-a')

  it('collects everything waiting across projects, current project first', () => {
    expect(buckets.needsYou.map((session) => session.id)).toEqual(['perm', 'input'])
  })

  it('scopes active to the current project and excludes waiting/terminal sessions', () => {
    expect(buckets.active.map((session) => session.id)).toEqual(['run', 'idle'])
  })

  it('scopes recent to the current project’s terminal sessions', () => {
    expect(buckets.recent.map((session) => session.id)).toEqual(['done'])
  })
})

describe('describeNavDetail', () => {
  const projectName = (): string => 'atlas-api'

  it('shows the prompt type and activity for a waiting session in the current project', () => {
    const session = makeDetail({
      projectId: 'proj-a',
      status: 'waiting-on-permission',
      pendingPrompt: { type: 'permission', text: 'Bash(x)' },
      activityLabel: '1m'
    })
    expect(describeNavDetail(session, 'proj-a', projectName())).toBe('permission · 1m')
  })

  it('appends the project name for a session in another project', () => {
    const session = makeDetail({
      projectId: 'proj-b',
      status: 'waiting-on-input',
      pendingPrompt: { type: 'input', text: 'which?' },
      activityLabel: '6m'
    })
    expect(describeNavDetail(session, 'proj-a', 'atlas-api')).toBe('input · 6m · atlas-api')
  })

  it('shows status and activity for an active session', () => {
    const session = makeDetail({ projectId: 'proj-a', status: 'running', activityLabel: '2m' })
    expect(describeNavDetail(session, 'proj-a', projectName())).toBe('running · 2m')
  })

  it('shows the diff stat for a finished session', () => {
    const session = makeDetail({
      projectId: 'proj-a',
      status: 'done',
      additions: 126,
      deletions: 301
    })
    expect(describeNavDetail(session, 'proj-a', projectName())).toBe('done · +126 −301')
  })

  it('falls back to the bare status when a finished session has no diff stat', () => {
    const session = makeDetail({ projectId: 'proj-a', status: 'stopped' })
    expect(describeNavDetail(session, 'proj-a', projectName())).toBe('stopped')
  })
})

describe('summarizeFilesTouched', () => {
  const file = (path: string, additions: number, deletions: number): FileDiff => ({
    path,
    status: 'modified',
    additions,
    deletions,
    diffText: ''
  })

  it('uses the Session totals for the header and collapses files beyond the diff sample', () => {
    const files = [file('a.ts', 64, 9), file('b.ts', 11, 2), file('c.ts', 188, 3)]
    const summary = summarizeFilesTouched(files, { additions: 412, deletions: 86, fileCount: 9 })
    expect(summary.totalAdditions).toBe(412)
    expect(summary.totalDeletions).toBe(86)
    expect(summary.rows.map((row) => row.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(summary.moreCount).toBe(6)
    expect(summary.moreAdditions).toBe(149)
    expect(summary.hasChanges).toBe(true)
  })

  it('falls back to summing the diff when Session totals are absent (live mode)', () => {
    const files = [file('a.ts', 3, 1), file('b.ts', 5, 2)]
    const summary = summarizeFilesTouched(files, {})
    expect(summary.totalAdditions).toBe(8)
    expect(summary.totalDeletions).toBe(3)
    expect(summary.moreCount).toBe(0)
    expect(summary.rows).toHaveLength(2)
  })

  it('reports no changes for an empty diff with no totals', () => {
    expect(summarizeFilesTouched([], {}).hasChanges).toBe(false)
  })
})

describe('upsertSession', () => {
  it('replaces the matching session by id, preserving position', () => {
    const sessions = [
      makeSession({ id: 'a', status: 'running' }),
      makeSession({ id: 'b', status: 'running' }),
      makeSession({ id: 'c', status: 'running' })
    ]
    const result = upsertSession(sessions, makeSession({ id: 'b', status: 'stopped' }))
    expect(result.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(result[1].status).toBe('stopped')
  })

  it('appends a session that is not already present (a fresh spawn)', () => {
    const sessions = [makeSession({ id: 'a' })]
    const result = upsertSession(sessions, makeSession({ id: 'new', status: 'idle' }))
    expect(result.map((s) => s.id)).toEqual(['a', 'new'])
  })

  it('never mutates the input array or its sessions', () => {
    const original = makeSession({ id: 'a', status: 'running' })
    const sessions = [original]
    const result = upsertSession(sessions, makeSession({ id: 'a', status: 'stopped' }))
    expect(result).not.toBe(sessions)
    expect(sessions[0]).toBe(original)
    expect(original.status).toBe('running')
  })
})

describe('removeSessionFromState', () => {
  it('drops the matching session by id, preserving the others in order', () => {
    const sessions = [makeSession({ id: 'a' }), makeSession({ id: 'b' }), makeSession({ id: 'c' })]
    const result = removeSessionFromState(sessions, 'b')
    expect(result.map((s) => s.id)).toEqual(['a', 'c'])
  })

  it('returns the same array reference when the id is not present', () => {
    const sessions = [makeSession({ id: 'a' })]
    expect(removeSessionFromState(sessions, 'missing')).toBe(sessions)
  })

  it('never mutates the input array', () => {
    const sessions = [makeSession({ id: 'a' }), makeSession({ id: 'b' })]
    const result = removeSessionFromState(sessions, 'a')
    expect(result).not.toBe(sessions)
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('removalDiscardsWorktree', () => {
  it('is true while the worktree is still on disk', () => {
    expect(removalDiscardsWorktree(makeSession({ status: 'stopped' }))).toBe(true)
  })

  it('is false once the worktree has already been removed', () => {
    expect(removalDiscardsWorktree(makeSession({ status: 'done', worktreeRemoved: true }))).toBe(false)
  })
})
