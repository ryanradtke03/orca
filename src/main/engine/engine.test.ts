import { describe, expect, it } from 'vitest'
import { createEngine } from './engine'
import { createFakeGitAdapter } from './fake-git-adapter'
import { createFakePersistenceAdapter } from './fake-persistence-adapter'

describe('Engine.ping', () => {
  it('reports ok status and the session count from the persistence adapter', async () => {
    const persistence = createFakePersistenceAdapter({ sessionCount: 3 })
    const git = createFakeGitAdapter()
    const engine = createEngine({ persistence, git })

    const result = await engine.ping()

    expect(result).toEqual({ ok: true, sessionCount: 3 })
  })

  it('defaults to zero sessions when nothing has been persisted', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const engine = createEngine({ persistence, git })

    const result = await engine.ping()

    expect(result).toEqual({ ok: true, sessionCount: 0 })
  })
})

describe('Engine.createWorktree', () => {
  it('delegates to the Git adapter, passing the project path through', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const engine = createEngine({ persistence, git })

    const result = await engine.createWorktree('/tmp/my-project')

    expect(result).toEqual({
      worktreePath: '/tmp/my-project/worktree-1',
      branch: 'orca-session-fake-1'
    })
  })

  it('returns a distinct worktree for each call', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const engine = createEngine({ persistence, git })

    const first = await engine.createWorktree('/tmp/my-project')
    const second = await engine.createWorktree('/tmp/my-project')

    expect(first.worktreePath).not.toBe(second.worktreePath)
    expect(first.branch).not.toBe(second.branch)
  })
})
