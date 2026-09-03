import { describe, expect, it } from 'vitest'
import type { Project, Session } from '../../shared/ipc-contract'
import {
  describeMergeMode,
  describeStatus,
  groupSessionsByProject,
  isAttentionStatus,
  isMergeable,
  isStoppable,
  isTerminalStatus,
  MERGE_MODES,
  needsAttentionSessions,
  summarizeStatuses
} from './session-view'

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
  it('allows stopping only running or waiting sessions', () => {
    expect(isStoppable('running')).toBe(true)
    expect(isStoppable('waiting-on-permission')).toBe(true)
    expect(isStoppable('waiting-on-input')).toBe(true)
    expect(isStoppable('idle')).toBe(false)
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
