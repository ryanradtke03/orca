import { describe, expect, it } from 'vitest'
import { createEngine } from './engine'
import { createFakeProcessAdapter } from './fake-process-adapter'
import { createFakePersistenceAdapter } from './fake-persistence-adapter'

describe('Engine.ping', () => {
  it('reports ok status and the session count from the persistence adapter', async () => {
    const persistence = createFakePersistenceAdapter({ sessionCount: 3 })
    const process = createFakeProcessAdapter()
    const engine = createEngine({ persistence, process })

    const result = await engine.ping()

    expect(result).toEqual({ ok: true, sessionCount: 3 })
  })

  it('defaults to zero sessions when nothing has been persisted', async () => {
    const persistence = createFakePersistenceAdapter()
    const process = createFakeProcessAdapter()
    const engine = createEngine({ persistence, process })

    const result = await engine.ping()

    expect(result).toEqual({ ok: true, sessionCount: 0 })
  })
})

describe('Engine.spawnProcess', () => {
  it('delegates to the Process adapter, passing the cwd through', async () => {
    const persistence = createFakePersistenceAdapter()
    const process = createFakeProcessAdapter({ pid: 4242 })
    const engine = createEngine({ persistence, process })

    const result = await engine.spawnProcess('/tmp/my-project/worktree-1')

    expect(result).toEqual({ pid: 4242 })
  })

  it('returns a distinct process for each call', async () => {
    const persistence = createFakePersistenceAdapter()
    const process = createFakeProcessAdapter()
    const engine = createEngine({ persistence, process })

    const first = await engine.spawnProcess('/tmp/my-project/worktree-1')
    const second = await engine.spawnProcess('/tmp/my-project/worktree-2')

    expect(first.pid).not.toBe(second.pid)
  })
})
