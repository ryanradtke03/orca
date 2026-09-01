import { describe, expect, it } from 'vitest'
import { createEngine } from './engine'
import { createFakePersistenceAdapter } from './fake-persistence-adapter'

describe('Engine.ping', () => {
  it('reports ok status and the session count from the persistence adapter', async () => {
    const persistence = createFakePersistenceAdapter({ sessionCount: 3 })
    const engine = createEngine({ persistence })

    const result = await engine.ping()

    expect(result).toEqual({ ok: true, sessionCount: 3 })
  })

  it('defaults to zero sessions when nothing has been persisted', async () => {
    const persistence = createFakePersistenceAdapter()
    const engine = createEngine({ persistence })

    const result = await engine.ping()

    expect(result).toEqual({ ok: true, sessionCount: 0 })
  })
})

describe('Engine.listProjects', () => {
  it('returns an empty list when nothing has been persisted', async () => {
    const persistence = createFakePersistenceAdapter()
    const engine = createEngine({ persistence })

    await expect(engine.listProjects()).resolves.toEqual([])
  })

  it('returns projects loaded from the persistence adapter', async () => {
    const seeded = [{ id: '1', path: '/tmp/foo', name: 'foo' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const engine = createEngine({ persistence })

    await expect(engine.listProjects()).resolves.toEqual(seeded)
  })
})

describe('Engine.addProject', () => {
  it('adds a project derived from the given path and returns it', async () => {
    const persistence = createFakePersistenceAdapter()
    const engine = createEngine({ persistence })

    const project = await engine.addProject('/tmp/my-project')

    expect(project).toMatchObject({ path: '/tmp/my-project', name: 'my-project' })
    expect(project.id).toEqual(expect.any(String))
  })

  it('assigns each added project a distinct id', async () => {
    const persistence = createFakePersistenceAdapter()
    const engine = createEngine({ persistence })

    const first = await engine.addProject('/tmp/one')
    const second = await engine.addProject('/tmp/two')

    expect(first.id).not.toBe(second.id)
  })

  it('appends to, rather than replaces, previously persisted projects', async () => {
    const seeded = [{ id: '1', path: '/tmp/foo', name: 'foo' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const engine = createEngine({ persistence })

    await engine.addProject('/tmp/bar')

    const projects = await engine.listProjects()
    expect(projects).toHaveLength(2)
    expect(projects[0]).toEqual(seeded[0])
    expect(projects[1]).toMatchObject({ path: '/tmp/bar', name: 'bar' })
  })

  it('persists the updated project list via the persistence adapter', async () => {
    const persistence = createFakePersistenceAdapter()
    const engine = createEngine({ persistence })

    await engine.addProject('/tmp/my-project')

    const freshEngine = createEngine({ persistence })
    await expect(freshEngine.listProjects()).resolves.toHaveLength(1)
  })

  it('does not drop a project when two adds race', async () => {
    const persistence = createFakePersistenceAdapter()
    const engine = createEngine({ persistence })

    const [first, second] = await Promise.all([
      engine.addProject('/tmp/one'),
      engine.addProject('/tmp/two')
    ])

    const projects = await engine.listProjects()
    expect(projects).toHaveLength(2)
    expect(projects.map((p) => p.id)).toEqual(expect.arrayContaining([first.id, second.id]))
  })
})
