import { describe, expect, it } from 'vitest'
import type { FileDiff } from '../../../shared/ipc-contract'
import { applyReviewed, isReviewed, reviewedPathsFor, toggleReviewed, type ReviewState } from './review'

function makeFile(path: string): FileDiff {
  return { path, status: 'modified', additions: 1, deletions: 0, diffText: '' }
}

describe('reviewedPathsFor', () => {
  it('returns an empty list for a session with no marks', () => {
    expect(reviewedPathsFor({}, 's1')).toEqual([])
  })

  it('returns the marked paths for a session', () => {
    expect(reviewedPathsFor({ s1: ['a.ts', 'b.ts'] }, 's1')).toEqual(['a.ts', 'b.ts'])
  })
})

describe('isReviewed', () => {
  it('is true only for a path marked in that session', () => {
    const state: ReviewState = { s1: ['a.ts'] }
    expect(isReviewed(state, 's1', 'a.ts')).toBe(true)
    expect(isReviewed(state, 's1', 'b.ts')).toBe(false)
    // Same path, different session - not reviewed.
    expect(isReviewed(state, 's2', 'a.ts')).toBe(false)
  })
})

describe('toggleReviewed', () => {
  it('marks a not-yet-reviewed file', () => {
    expect(toggleReviewed({}, 's1', 'a.ts')).toEqual({ s1: ['a.ts'] })
  })

  it('unmarks an already-reviewed file', () => {
    expect(toggleReviewed({ s1: ['a.ts', 'b.ts'] }, 's1', 'a.ts')).toEqual({ s1: ['b.ts'] })
  })

  it('keeps other sessions untouched', () => {
    expect(toggleReviewed({ s1: ['a.ts'] }, 's2', 'x.ts')).toEqual({ s1: ['a.ts'], s2: ['x.ts'] })
  })

  it('never mutates the input state', () => {
    const state: ReviewState = { s1: ['a.ts'] }
    const next = toggleReviewed(state, 's1', 'b.ts')
    expect(state).toEqual({ s1: ['a.ts'] })
    expect(next).not.toBe(state)
  })
})

describe('applyReviewed', () => {
  it('stamps reviewed=true only on paths in the list', () => {
    const files = [makeFile('a.ts'), makeFile('b.ts')]
    expect(applyReviewed(files, ['a.ts']).map((file) => file.reviewed)).toEqual([true, false])
  })

  it('overrides any reviewed flag the incoming payload carried', () => {
    const carried = { ...makeFile('a.ts'), reviewed: true } as FileDiff
    expect(applyReviewed([carried], []).map((file) => file.reviewed)).toEqual([false])
  })

  it('leaves the source files unmutated', () => {
    const files = [makeFile('a.ts')]
    applyReviewed(files, ['a.ts'])
    expect(files[0]).not.toHaveProperty('reviewed')
  })
})
