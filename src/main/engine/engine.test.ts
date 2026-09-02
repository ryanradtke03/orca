import { describe, expect, it } from 'vitest'
import { createEngine } from './engine'
import { createFakeGitAdapter } from './fake-git-adapter'
import { createFakePersistenceAdapter } from './fake-persistence-adapter'
import { createFakeProcessAdapter } from './fake-process-adapter'

describe('Engine.ping', () => {
  it('reports ok status and the session count from the persistence adapter', async () => {
    const persistence = createFakePersistenceAdapter({ sessionCount: 3 })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const result = await engine.ping()

    expect(result).toEqual({ ok: true, sessionCount: 3 })
  })

  it('defaults to zero sessions when nothing has been persisted', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const result = await engine.ping()

    expect(result).toEqual({ ok: true, sessionCount: 0 })
  })
})

describe('Engine.listProjects', () => {
  it('returns an empty list when nothing has been persisted', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    await expect(engine.listProjects()).resolves.toEqual([])
  })

  it('returns projects loaded from the persistence adapter', async () => {
    const seeded = [{ id: '1', path: '/tmp/foo', name: 'foo' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    await expect(engine.listProjects()).resolves.toEqual(seeded)
  })
})

describe('Engine.addProject', () => {
  it('adds a project derived from the given path and returns it', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const project = await engine.addProject('/tmp/my-project')

    expect(project).toMatchObject({ path: '/tmp/my-project', name: 'my-project' })
    expect(project.id).toEqual(expect.any(String))
  })

  it('assigns each added project a distinct id', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const first = await engine.addProject('/tmp/one')
    const second = await engine.addProject('/tmp/two')

    expect(first.id).not.toBe(second.id)
  })

  it('appends to, rather than replaces, previously persisted projects', async () => {
    const seeded = [{ id: '1', path: '/tmp/foo', name: 'foo' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    await engine.addProject('/tmp/bar')

    const projects = await engine.listProjects()
    expect(projects).toHaveLength(2)
    expect(projects[0]).toEqual(seeded[0])
    expect(projects[1]).toMatchObject({ path: '/tmp/bar', name: 'bar' })
  })

  it('persists the updated project list via the persistence adapter', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    await engine.addProject('/tmp/my-project')

    const freshEngine = createEngine({ persistence, git, process: processAdapter })
    await expect(freshEngine.listProjects()).resolves.toHaveLength(1)
  })

  it('does not drop a project when two adds race', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const [first, second] = await Promise.all([
      engine.addProject('/tmp/one'),
      engine.addProject('/tmp/two')
    ])

    const projects = await engine.listProjects()
    expect(projects).toHaveLength(2)
    expect(projects.map((p) => p.id)).toEqual(expect.arrayContaining([first.id, second.id]))
  })
})

describe('Engine.createWorktree', () => {
  it('delegates to the Git adapter, passing the project path through', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const result = await engine.createWorktree('/tmp/my-project')

    expect(result).toEqual({
      worktreePath: '/tmp/my-project/worktree-1',
      branch: 'orca-session-fake-1'
    })
  })

  it('returns a distinct worktree for each call', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const first = await engine.createWorktree('/tmp/my-project')
    const second = await engine.createWorktree('/tmp/my-project')

    expect(first.worktreePath).not.toBe(second.worktreePath)
    expect(first.branch).not.toBe(second.branch)
  })
})

describe('Engine.spawnSession', () => {
  it('creates a worktree for the project and spawns a process inside it', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const session = await engine.spawnSession('project-1')

    expect(session).toMatchObject({
      projectId: 'project-1',
      worktreePath: '/tmp/my-project/worktree-1',
      branch: 'orca-session-fake-1'
    })
    expect(session.id).toEqual(expect.any(String))
    expect(session.pid).toEqual(expect.any(Number))
    // The process must be spawned inside the worktree Git just created, not the project root.
    expect(processAdapter.spawnedCwds).toEqual([session.worktreePath])
  })

  it('tracks the spawned session so it is returned by listSessions', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const session = await engine.spawnSession('project-1')

    await expect(engine.listSessions()).resolves.toEqual([session])
  })

  it('rejects when the project id is unknown', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    await expect(engine.spawnSession('missing')).rejects.toThrow('Unknown project: missing')
  })

  it('accumulates multiple sessions across multiple spawns', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const first = await engine.spawnSession('project-1')
    const second = await engine.spawnSession('project-1')

    const sessions = await engine.listSessions()
    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.id)).toEqual([first.id, second.id])
  })
})

describe('Engine.listSessions', () => {
  it('returns an empty list before any session has been spawned', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    await expect(engine.listSessions()).resolves.toEqual([])
  })

  it('reports a freshly spawned session as running', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const session = await engine.spawnSession('project-1')

    expect(session.status).toBe('running')
  })
})

describe('Engine.stopSession', () => {
  async function spawnRunningSession(processAdapter = createFakeProcessAdapter()) {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const session = await engine.spawnSession('project-1')

    return { engine, session, processAdapter }
  }

  it('sends a stop signal to the session process via the Process adapter', async () => {
    const { engine, session, processAdapter } = await spawnRunningSession()

    await engine.stopSession(session.id)

    expect(processAdapter.stoppedPids).toEqual([session.pid])
  })

  it('updates the session status to stopped', async () => {
    const { engine, session } = await spawnRunningSession()

    const stopped = await engine.stopSession(session.id)

    expect(stopped).toMatchObject({ id: session.id, status: 'stopped' })
  })

  it('persists the stopped status so it is reflected by listSessions', async () => {
    const { engine, session } = await spawnRunningSession()

    await engine.stopSession(session.id)

    const sessions = await engine.listSessions()
    expect(sessions).toEqual([expect.objectContaining({ id: session.id, status: 'stopped' })])
  })

  it('rejects when the session id is unknown', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    await expect(engine.stopSession('missing')).rejects.toThrow('Unknown session: missing')
  })

  it('does not affect other sessions', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter })

    const first = await engine.spawnSession('project-1')
    const second = await engine.spawnSession('project-1')

    await engine.stopSession(first.id)

    const sessions = await engine.listSessions()
    expect(sessions).toEqual([
      expect.objectContaining({ id: first.id, status: 'stopped' }),
      expect.objectContaining({ id: second.id, status: 'running' })
    ])
  })
})
