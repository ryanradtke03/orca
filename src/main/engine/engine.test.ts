import { describe, expect, it } from 'vitest'
import { createEngine } from './engine'
import { createFakeDiscoveryAdapter } from './adapters/discovery/fake'
import { createFakeGitAdapter } from './adapters/git/fake'
import { createFakeGitHubAdapter } from './adapters/github/fake'
import { createFakeNotificationAdapter } from './adapters/notification/fake'
import { createFakePersistenceAdapter } from './adapters/persistence/fake'
import { createFakeProcessAdapter } from './adapters/process/fake'

describe('Engine.ping', () => {
  it('reports ok status and the session count from the persistence adapter', async () => {
    const persistence = createFakePersistenceAdapter({ sessionCount: 3 })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const result = await engine.ping()

    expect(result).toEqual({ ok: true, sessionCount: 3 })
  })

  it('defaults to zero sessions when nothing has been persisted', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const result = await engine.ping()

    expect(result).toEqual({ ok: true, sessionCount: 0 })
  })
})

describe('Engine.listProjects', () => {
  it('returns an empty list when nothing has been persisted', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await expect(engine.listProjects()).resolves.toEqual([])
  })

  it('returns projects loaded from the persistence adapter', async () => {
    const seeded = [{ id: '1', path: '/tmp/foo', name: 'foo', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await expect(engine.listProjects()).resolves.toEqual(seeded)
  })
})

describe('Engine.addProject', () => {
  it('adds a project derived from the given path and returns it', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const project = await engine.addProject('/tmp/my-project')

    expect(project).toMatchObject({ path: '/tmp/my-project', name: 'my-project' })
    expect(project.id).toEqual(expect.any(String))
  })

  it('assigns each added project a distinct id', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const first = await engine.addProject('/tmp/one')
    const second = await engine.addProject('/tmp/two')

    expect(first.id).not.toBe(second.id)
  })

  it('appends to, rather than replaces, previously persisted projects', async () => {
    const seeded = [{ id: '1', path: '/tmp/foo', name: 'foo', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

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
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await engine.addProject('/tmp/my-project')

    const freshEngine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    await expect(freshEngine.listProjects()).resolves.toHaveLength(1)
  })

  it('does not drop a project when two adds race', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

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
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const result = await engine.createWorktree('/tmp/my-project')

    expect(result).toEqual({
      worktreePath: '/tmp/my-project/worktree-1',
      branch: 'orca-session-fake-1',
      baseRef: 'base-1'
    })
  })

  it('returns a distinct worktree for each call', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const first = await engine.createWorktree('/tmp/my-project')
    const second = await engine.createWorktree('/tmp/my-project')

    expect(first.worktreePath).not.toBe(second.worktreePath)
    expect(first.branch).not.toBe(second.branch)
  })
})

describe('Engine.spawnSession', () => {
  it('creates a worktree for the project and spawns a process inside it', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const session = await engine.spawnSession('project-1')

    expect(session).toMatchObject({
      projectId: 'project-1',
      worktreePath: '/tmp/my-project/worktree-1',
      branch: 'orca-session-fake-1',
      status: 'running'
    })
    expect(session.id).toEqual(expect.any(String))
    expect(session.pid).toEqual(expect.any(Number))
    // The process must be spawned inside the worktree Git just created, not the project root.
    expect(processAdapter.spawnedCwds).toEqual([session.worktreePath])
  })

  it('tracks the spawned session so it is returned by listSessions', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const session = await engine.spawnSession('project-1')

    await expect(engine.listSessions()).resolves.toEqual([session])
  })

  it('rejects when the project id is unknown', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await expect(engine.spawnSession('missing')).rejects.toThrow('Unknown project: missing')
  })

  it('accumulates multiple sessions across multiple spawns', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

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
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await expect(engine.listSessions()).resolves.toEqual([])
  })

  it('reports a freshly spawned session as running', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const session = await engine.spawnSession('project-1')

    expect(session.status).toBe('running')
  })
})

describe('Engine.stopSession', () => {
  async function spawnRunningSession(processAdapter = createFakeProcessAdapter()) {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

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

  it('leaves the worktree in place after stopping, so its diff stays reviewable', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const session = await engine.spawnSession('project-1')

    await engine.stopSession(session.id)

    expect(git.removeWorktreeCalls).toEqual([])
  })

  it('clears a pending prompt when stopping a session that was waiting on one', async () => {
    const processAdapter = createFakeProcessAdapter()
    const { engine, session } = await spawnRunningSession(processAdapter)
    processAdapter.simulatePrompt(session.pid, { type: 'permission', text: 'Run npm install?' })
    await engine.refreshSessionStatuses()

    const stopped = await engine.stopSession(session.id)

    expect(stopped.pendingPrompt).toBeUndefined()
  })

  it('rejects when the session id is unknown', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await expect(engine.stopSession('missing')).rejects.toThrow('Unknown session: missing')
  })

  it('does not affect other sessions', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

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

describe('Engine.refreshSessionStatuses', () => {
  const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]

  it('keeps polling a discovered Session that started out idle, not just ones spawned running', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    // A process already alive and known to the Process adapter, but not yet
    // an Engine Session - exactly what Discovery hands off.
    const { pid } = await processAdapter.spawnClaude('/tmp/my-project')
    discovery.simulateSession({
      pid,
      cwd: '/tmp/my-project',
      projectPath: '/tmp/my-project',
      branch: 'idle-branch',
      baseRef: 'abc123',
      status: 'idle'
    })
    await engine.discoverSessions()

    processAdapter.simulateExit(pid, 0)
    const [session] = await engine.refreshSessionStatuses()

    expect(session.status).toBe('done')
  })

  it('leaves a session running while its process is still alive, without notifying', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await engine.spawnSession('project-1')
    const [session] = await engine.refreshSessionStatuses()

    expect(session.status).toBe('running')
    expect(notification.notifications).toEqual([])
  })

  it('transitions a session to done and fires a low-priority notification on a clean exit', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    const [session] = await engine.refreshSessionStatuses()

    expect(session.status).toBe('done')
    expect(notification.notifications).toEqual([
      expect.objectContaining({ urgency: 'low' })
    ])
  })

  it('transitions a session to errored and fires a critical notification on a nonzero exit', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 1)
    const [session] = await engine.refreshSessionStatuses()

    expect(session.status).toBe('errored')
    expect(notification.notifications).toEqual([
      expect.objectContaining({ urgency: 'critical' })
    ])
  })

  it('treats a signal-killed process (null exit code) as errored', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, null)
    const [session] = await engine.refreshSessionStatuses()

    expect(session.status).toBe('errored')
  })

  it('does not re-fire a notification once a session has reached a terminal status', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 1)

    await engine.refreshSessionStatuses()
    await engine.refreshSessionStatuses()

    expect(notification.notifications).toHaveLength(1)
  })

  it('reflects the updated status through listSessions', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()

    const [session] = await engine.listSessions()
    expect(session.status).toBe('done')
  })

  it('leaves the worktree in place once a session transitions to done, so its diff stays reviewable', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()

    expect(git.removeWorktreeCalls).toEqual([])
  })

  it('leaves the worktree in place once a session transitions to errored, so its diff stays reviewable', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 1)
    await engine.refreshSessionStatuses()

    expect(git.removeWorktreeCalls).toEqual([])
  })

  it('resolves multiple sessions independently based on their own process outcome', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const first = await engine.spawnSession('project-1')
    const second = await engine.spawnSession('project-1')
    processAdapter.simulateExit(first.pid, 0)

    const sessions = await engine.refreshSessionStatuses()

    expect(sessions.find((s) => s.id === first.id)?.status).toBe('done')
    expect(sessions.find((s) => s.id === second.id)?.status).toBe('running')
  })

  it('transitions a session to waiting-on-permission and fires a notification when the process pauses on a permission prompt', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulatePrompt(spawned.pid, { type: 'permission', text: 'Run npm install?' })
    const [session] = await engine.refreshSessionStatuses()

    expect(session.status).toBe('waiting-on-permission')
    expect(session.pendingPrompt).toEqual({ type: 'permission', text: 'Run npm install?' })
    expect(notification.notifications).toEqual([expect.objectContaining({ urgency: 'critical' })])
  })

  it('transitions a session to waiting-on-input and fires a notification when the process pauses on a clarifying question', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulatePrompt(spawned.pid, { type: 'input', text: 'Which branch?' })
    const [session] = await engine.refreshSessionStatuses()

    expect(session.status).toBe('waiting-on-input')
    expect(session.pendingPrompt).toEqual({ type: 'input', text: 'Which branch?' })
    expect(notification.notifications).toEqual([expect.objectContaining({ urgency: 'critical' })])
  })

  it('does not re-fire a notification on repeated refreshes while the same prompt is still pending', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulatePrompt(spawned.pid, { type: 'permission', text: 'Run npm install?' })

    await engine.refreshSessionStatuses()
    await engine.refreshSessionStatuses()

    expect(notification.notifications).toHaveLength(1)
  })

  it('fires a fresh notification when a new prompt replaces an already-answered one', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulatePrompt(spawned.pid, { type: 'permission', text: 'Run npm install?' })
    await engine.refreshSessionStatuses()

    processAdapter.simulatePrompt(spawned.pid, { type: 'permission', text: 'Run npm test?' })
    const [session] = await engine.refreshSessionStatuses()

    expect(session.pendingPrompt).toEqual({ type: 'permission', text: 'Run npm test?' })
    expect(notification.notifications).toHaveLength(2)
  })

  it('returns a waiting session to running once the process no longer reports a pending prompt', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulatePrompt(spawned.pid, { type: 'permission', text: 'Run npm install?' })
    await engine.refreshSessionStatuses()

    await processAdapter.respond(spawned.pid, 'yes')
    const [session] = await engine.refreshSessionStatuses()

    expect(session.status).toBe('running')
    expect(session.pendingPrompt).toBeUndefined()
  })
})

describe('Engine.respondToPrompt', () => {
  const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]

  it('forwards the response to the Process adapter for the session', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulatePrompt(spawned.pid, { type: 'permission', text: 'Run npm install?' })
    await engine.refreshSessionStatuses()

    await engine.respondToPrompt(spawned.id, 'yes')

    expect(processAdapter.responses).toEqual([{ pid: spawned.pid, text: 'yes' }])
  })

  it('transitions the session back to running and clears the pending prompt', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulatePrompt(spawned.pid, { type: 'permission', text: 'Run npm install?' })
    await engine.refreshSessionStatuses()

    const updated = await engine.respondToPrompt(spawned.id, 'yes')

    expect(updated.status).toBe('running')
    expect(updated.pendingPrompt).toBeUndefined()
  })

  it('rejects when the session id is unknown', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await expect(engine.respondToPrompt('missing', 'yes')).rejects.toThrow(
      'Unknown session: missing'
    )
  })

  it('rejects when the session has no pending prompt', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const spawned = await engine.spawnSession('project-1')

    await expect(engine.respondToPrompt(spawned.id, 'yes')).rejects.toThrow(
      `Session has no pending prompt: ${spawned.id}`
    )
  })
})

describe('Engine.getDiff', () => {
  const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]

  it("delegates to the Git adapter with the session's worktree path and base ref", async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')

    await engine.getDiff(spawned.id)

    expect(git.getDiffCalls).toEqual([{ worktreePath: spawned.worktreePath, baseRef: spawned.baseRef }])
  })

  it('returns the file diffs reported by the Git adapter', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    const files = [
      { path: 'foo.ts', status: 'modified' as const, additions: 3, deletions: 1, diffText: '...' }
    ]
    git.simulateDiff(spawned.worktreePath, files)

    await expect(engine.getDiff(spawned.id)).resolves.toEqual(files)
  })

  it('rejects when the session id is unknown', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await expect(engine.getDiff('missing')).rejects.toThrow('Unknown session: missing')
  })

  it('keeps diffing against the same base ref even after the session finishes', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()

    await engine.getDiff(spawned.id)

    expect(git.getDiffCalls).toEqual([{ worktreePath: spawned.worktreePath, baseRef: spawned.baseRef }])
  })

  it('rejects once the worktree has been removed, rather than diffing a path that no longer exists', async () => {
    const localMergeSeeded = [
      { id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'local-merge' as const }
    ]
    const persistence = createFakePersistenceAdapter({ projects: localMergeSeeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()
    await engine.requestMerge(spawned.id)

    await expect(engine.getDiff(spawned.id)).rejects.toThrow(
      `Worktree already removed for session: ${spawned.id}`
    )
  })
})

describe('Engine.setProjectMergeMode', () => {
  const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]

  it('defaults a newly added project to Manual', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const project = await engine.addProject('/tmp/my-project')

    expect(project.mergeMode).toBe('manual')
  })

  it('updates the merge mode for the given project', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const updated = await engine.setProjectMergeMode('project-1', 'local-merge')

    expect(updated).toMatchObject({ id: 'project-1', mergeMode: 'local-merge' })
  })

  it('persists the updated merge mode so it is reflected by listProjects', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await engine.setProjectMergeMode('project-1', 'pull-request')

    const projects = await engine.listProjects()
    expect(projects[0].mergeMode).toBe('pull-request')
  })

  it('does not affect other projects', async () => {
    const twoProjects = [
      ...seeded,
      { id: 'project-2', path: '/tmp/other-project', name: 'other-project', mergeMode: 'manual' as const }
    ]
    const persistence = createFakePersistenceAdapter({ projects: twoProjects })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await engine.setProjectMergeMode('project-1', 'local-merge')

    const projects = await engine.listProjects()
    expect(projects.find((p) => p.id === 'project-2')?.mergeMode).toBe('manual')
  })

  it('rejects when the project id is unknown', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await expect(engine.setProjectMergeMode('missing', 'local-merge')).rejects.toThrow(
      'Unknown project: missing'
    )
  })
})

describe('Engine.requestMerge', () => {
  it('performs no adapter calls when Merge mode is Manual', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()

    const result = await engine.requestMerge(spawned.id)

    expect(result).toEqual({ mergeMode: 'manual' })
    expect(git.mergeWorktreeCalls).toEqual([])
    expect(git.pushBranchCalls).toEqual([])
    expect(github.openPullRequestCalls).toEqual([])
  })

  it('merges the worktree branch into the Project via the Git adapter when Merge mode is Local merge', async () => {
    const seeded = [
      { id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'local-merge' as const }
    ]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()

    const result = await engine.requestMerge(spawned.id)

    expect(git.mergeWorktreeCalls).toEqual([
      { projectPath: '/tmp/my-project', worktreePath: spawned.worktreePath, branch: spawned.branch }
    ])
    expect(git.pushBranchCalls).toEqual([])
    expect(github.openPullRequestCalls).toEqual([])
    expect(result).toEqual({ mergeMode: 'local-merge' })
  })

  it('opens a pull request via the GitHub adapter when Merge mode is Pull request', async () => {
    const seeded = [
      { id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'pull-request' as const }
    ]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()

    const result = await engine.requestMerge(spawned.id)

    expect(git.pushBranchCalls).toEqual([{ worktreePath: spawned.worktreePath, branch: spawned.branch }])
    expect(github.openPullRequestCalls).toEqual([
      { projectPath: '/tmp/my-project', branch: spawned.branch, title: spawned.branch }
    ])
    expect(git.mergeWorktreeCalls).toEqual([])
    expect(result).toEqual({ mergeMode: 'pull-request', pullRequestUrl: expect.any(String) })
  })

  it('pushes the branch before opening the pull request', async () => {
    const seeded = [
      { id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'pull-request' as const }
    ]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const calls: string[] = []
    const originalPushBranch = git.pushBranch.bind(git)
    git.pushBranch = async (worktreePath, branch) => {
      calls.push('push')
      return originalPushBranch(worktreePath, branch)
    }
    const originalOpenPullRequest = github.openPullRequest.bind(github)
    github.openPullRequest = async (params) => {
      calls.push('open-pr')
      return originalOpenPullRequest(params)
    }
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()

    await engine.requestMerge(spawned.id)

    expect(calls).toEqual(['push', 'open-pr'])
  })

  it('rejects when the session id is unknown', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await expect(engine.requestMerge('missing')).rejects.toThrow('Unknown session: missing')
  })

  it('rejects when the session has not finished', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')

    await expect(engine.requestMerge(spawned.id)).rejects.toThrow(`Session is not finished: ${spawned.id}`)
  })

  it('removes the worktree once a Local merge actually succeeds, since nothing is left to review', async () => {
    const seeded = [
      { id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'local-merge' as const }
    ]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()

    await engine.requestMerge(spawned.id)

    expect(git.removeWorktreeCalls).toEqual([
      { projectPath: '/tmp/my-project', worktreePath: spawned.worktreePath }
    ])
    const [session] = await engine.listSessions()
    expect(session.worktreeRemoved).toBe(true)
  })

  it('leaves the worktree in place if the Git adapter fails to remove it after a Local merge', async () => {
    const seeded = [
      { id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'local-merge' as const }
    ]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    git.removeWorktree = async () => {
      throw new Error('worktree still has uncommitted changes')
    }
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()

    await engine.requestMerge(spawned.id)

    const [session] = await engine.listSessions()
    expect(session.worktreeRemoved).toBeUndefined()
  })

  it('leaves the worktree in place after opening a Pull request, since the branch is not integrated yet', async () => {
    const seeded = [
      { id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'pull-request' as const }
    ]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()

    const result = await engine.requestMerge(spawned.id)

    expect(git.removeWorktreeCalls).toEqual([])
    const [session] = await engine.listSessions()
    expect(session.worktreeRemoved).toBeUndefined()
    expect(session.pullRequestUrl).toBe(result.pullRequestUrl)
  })

  it('rejects a second merge request once the worktree has already been removed', async () => {
    const seeded = [
      { id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'local-merge' as const }
    ]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()
    await engine.requestMerge(spawned.id)

    await expect(engine.requestMerge(spawned.id)).rejects.toThrow(
      `Worktree already removed for session: ${spawned.id}`
    )
  })

  it('rejects a concurrent second requestMerge for the same session while the first is still in flight', async () => {
    const seeded = [
      { id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'local-merge' as const }
    ]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()

    let releaseMerge!: () => void
    const mergeStarted = new Promise<void>((resolveStarted) => {
      const original = git.mergeWorktree.bind(git)
      git.mergeWorktree = async (params) => {
        resolveStarted()
        await new Promise<void>((resolveRelease) => {
          releaseMerge = resolveRelease
        })
        return original(params)
      }
    })

    const first = engine.requestMerge(spawned.id)
    await mergeStarted

    await expect(engine.requestMerge(spawned.id)).rejects.toThrow(
      `A worktree operation is already in progress for session: ${spawned.id}`
    )

    releaseMerge()
    await first
  })
})

describe('Engine.refreshSessionStatuses (Pull request worktree cleanup)', () => {
  async function spawnSessionWithOpenPullRequest() {
    const seeded = [
      { id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'pull-request' as const }
    ]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()
    const { pullRequestUrl } = await engine.requestMerge(spawned.id)

    return { engine, git, github, spawned, pullRequestUrl: pullRequestUrl! }
  }

  it('removes the worktree once GitHub reports the pull request merged', async () => {
    const { engine, git, github, spawned, pullRequestUrl } = await spawnSessionWithOpenPullRequest()
    github.simulateMerged(pullRequestUrl)

    await engine.refreshSessionStatuses()

    expect(git.removeWorktreeCalls).toEqual([
      { projectPath: '/tmp/my-project', worktreePath: spawned.worktreePath }
    ])
    const [session] = await engine.listSessions()
    expect(session.worktreeRemoved).toBe(true)
  })

  it('leaves the worktree in place while the pull request is still open', async () => {
    const { engine, git } = await spawnSessionWithOpenPullRequest()

    await engine.refreshSessionStatuses()

    expect(git.removeWorktreeCalls).toEqual([])
    const [session] = await engine.listSessions()
    expect(session.worktreeRemoved).toBeUndefined()
  })

  it('leaves the worktree in place when the pull request is closed without merging', async () => {
    const { engine, git, github, pullRequestUrl } = await spawnSessionWithOpenPullRequest()
    github.simulateClosed(pullRequestUrl)

    await engine.refreshSessionStatuses()

    expect(git.removeWorktreeCalls).toEqual([])
    const [session] = await engine.listSessions()
    expect(session.worktreeRemoved).toBeUndefined()
  })

  it('does not poll GitHub for sessions without a pull request', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)

    await engine.refreshSessionStatuses()

    expect(github.getPullRequestStatusCalls).toEqual([])
  })

  it('stops polling GitHub once the worktree has been removed', async () => {
    const { engine, github, pullRequestUrl } = await spawnSessionWithOpenPullRequest()
    github.simulateMerged(pullRequestUrl)
    await engine.refreshSessionStatuses()

    await engine.refreshSessionStatuses()

    expect(github.getPullRequestStatusCalls).toEqual([pullRequestUrl])
  })

  it("does not drop other sessions' status updates when checking a pull request's status fails", async () => {
    const seeded = [
      { id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'pull-request' as const }
    ]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const withPr = await engine.spawnSession('project-1')
    processAdapter.simulateExit(withPr.pid, 0)
    await engine.refreshSessionStatuses()
    await engine.requestMerge(withPr.id)
    github.getPullRequestStatus = async () => {
      throw new Error('gh: not authenticated')
    }

    const unrelated = await engine.spawnSession('project-1')
    processAdapter.simulateExit(unrelated.pid, 0)

    await expect(engine.refreshSessionStatuses()).resolves.not.toThrow()

    const sessions = await engine.listSessions()
    expect(sessions.find((s) => s.id === unrelated.id)?.status).toBe('done')
  })
})

describe('Engine.discardWorktree', () => {
  async function spawnStoppedSession() {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    await engine.stopSession(spawned.id)

    return { engine, git, spawned }
  }

  it("force-removes the session's worktree via the Git adapter", async () => {
    const { engine, git, spawned } = await spawnStoppedSession()

    await engine.discardWorktree(spawned.id)

    expect(git.discardWorktreeCalls).toEqual([
      { projectPath: '/tmp/my-project', worktreePath: spawned.worktreePath }
    ])
  })

  it('marks the worktree removed so it is reflected through listSessions', async () => {
    const { engine, spawned } = await spawnStoppedSession()

    const discarded = await engine.discardWorktree(spawned.id)

    expect(discarded.worktreeRemoved).toBe(true)
    const [session] = await engine.listSessions()
    expect(session.worktreeRemoved).toBe(true)
  })

  it('rejects when the session id is unknown', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await expect(engine.discardWorktree('missing')).rejects.toThrow('Unknown session: missing')
  })

  it('rejects when the session is still active', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')

    await expect(engine.discardWorktree(spawned.id)).rejects.toThrow(`Session is still active: ${spawned.id}`)
  })

  it('rejects when the worktree has already been removed', async () => {
    const { engine, spawned } = await spawnStoppedSession()
    await engine.discardWorktree(spawned.id)

    await expect(engine.discardWorktree(spawned.id)).rejects.toThrow(
      `Worktree already removed for session: ${spawned.id}`
    )
  })

  it('rejects a concurrent second discardWorktree for the same session while the first is still in flight', async () => {
    const { engine, git, spawned } = await spawnStoppedSession()

    let releaseDiscard!: () => void
    const discardStarted = new Promise<void>((resolveStarted) => {
      const original = git.discardWorktree.bind(git)
      git.discardWorktree = async (projectPath, worktreePath) => {
        resolveStarted()
        await new Promise<void>((resolveRelease) => {
          releaseDiscard = resolveRelease
        })
        return original(projectPath, worktreePath)
      }
    })

    const first = engine.discardWorktree(spawned.id)
    await discardStarted

    await expect(engine.discardWorktree(spawned.id)).rejects.toThrow(
      `A worktree operation is already in progress for session: ${spawned.id}`
    )

    releaseDiscard()
    await first
  })
})

describe('Engine.discoverSessions', () => {
  it('returns an empty list when nothing is discovered and nothing is tracked', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await expect(engine.discoverSessions()).resolves.toEqual([])
  })

  it('adds a discovered session to an existing Project matched by path', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateSession({
      pid: 4242,
      cwd: '/tmp/my-project',
      projectPath: '/tmp/my-project',
      branch: 'work-in-progress',
      baseRef: 'abc123',
      status: 'running'
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const sessions = await engine.discoverSessions()

    expect(sessions).toEqual([
      {
        id: expect.any(String),
        projectId: 'project-1',
        worktreePath: '/tmp/my-project',
        branch: 'work-in-progress',
        baseRef: 'abc123',
        pid: 4242,
        status: 'running',
        pendingPrompt: undefined
      }
    ])
  })

  it('surfaces the discovered session through listSessions afterward', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateSession({
      pid: 4242,
      cwd: '/tmp/my-project',
      projectPath: '/tmp/my-project',
      branch: 'work-in-progress',
      baseRef: 'abc123',
      status: 'idle'
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await engine.discoverSessions()

    await expect(engine.listSessions()).resolves.toEqual([
      expect.objectContaining({ pid: 4242, status: 'idle' })
    ])
  })

  it('creates a new Project when no existing Project matches the discovered project path', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateSession({
      pid: 4242,
      cwd: '/tmp/unlisted-project',
      projectPath: '/tmp/unlisted-project',
      branch: 'main',
      baseRef: 'abc123',
      status: 'running'
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const [session] = await engine.discoverSessions()

    const projects = await engine.listProjects()
    expect(projects).toEqual([
      { id: expect.any(String), path: '/tmp/unlisted-project', name: 'unlisted-project', mergeMode: 'manual' }
    ])
    expect(session.projectId).toBe(projects[0].id)
  })

  it('persists a newly created Project so a fresh Engine sees it too', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateSession({
      pid: 4242,
      cwd: '/tmp/unlisted-project',
      projectPath: '/tmp/unlisted-project',
      branch: 'main',
      baseRef: 'abc123',
      status: 'running'
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    await engine.discoverSessions()

    const freshEngine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    await expect(freshEngine.listProjects()).resolves.toHaveLength(1)
  })

  it('creates only one new Project for two discovered sessions that share the same project path', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateSession({
      pid: 1111,
      cwd: '/tmp/shared-project/worktree-a',
      projectPath: '/tmp/shared-project',
      branch: 'branch-a',
      baseRef: 'abc123',
      status: 'running'
    })
    discovery.simulateSession({
      pid: 2222,
      cwd: '/tmp/shared-project/worktree-b',
      projectPath: '/tmp/shared-project',
      branch: 'branch-b',
      baseRef: 'def456',
      status: 'running'
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const sessions = await engine.discoverSessions()

    const projects = await engine.listProjects()
    expect(projects).toHaveLength(1)
    expect(sessions.map((s) => s.projectId)).toEqual([projects[0].id, projects[0].id])
  })

  it('does not re-add a session whose pid is already tracked as a spawned Session', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    discovery.simulateSession({
      pid: spawned.pid,
      cwd: spawned.worktreePath,
      projectPath: '/tmp/my-project',
      branch: spawned.branch,
      baseRef: spawned.baseRef,
      status: 'running'
    })

    const sessions = await engine.discoverSessions()

    expect(sessions).toEqual([spawned])
  })

  it('does not re-add the same discovered session on a second scan', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateSession({
      pid: 4242,
      cwd: '/tmp/my-project',
      projectPath: '/tmp/my-project',
      branch: 'work-in-progress',
      baseRef: 'abc123',
      status: 'running'
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await engine.discoverSessions()
    const sessions = await engine.discoverSessions()

    expect(sessions).toHaveLength(1)
  })

  it('leaves already-tracked sessions untouched, even if Discovery keeps reporting them', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    discovery.simulateSession({
      pid: spawned.pid,
      cwd: spawned.worktreePath,
      projectPath: '/tmp/my-project',
      branch: spawned.branch,
      baseRef: spawned.baseRef,
      // Deliberately different from the tracked Session's actual status -
      // refreshSessionStatuses owns keeping status current, not Discovery.
      status: 'errored'
    })

    await engine.discoverSessions()

    const sessions = await engine.listSessions()
    expect(sessions).toEqual([expect.objectContaining({ id: spawned.id, status: 'running' })])
  })

  it('rediscovers a Session that was spawned in a previous run and is still alive (ADR-0002)', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const firstRunEngine = createEngine({
      persistence,
      git,
      process: processAdapter,
      notification,
      github,
      discovery
    })
    const spawnedLastRun = await firstRunEngine.spawnSession('project-1')
    // A relaunch starts a brand-new in-memory Engine (nothing survives a real
    // quit except the still-running process itself and what's on disk).
    const relaunchedEngine = createEngine({
      persistence,
      git,
      process: processAdapter,
      notification,
      github,
      discovery
    })
    discovery.simulateSession({
      pid: spawnedLastRun.pid,
      cwd: spawnedLastRun.worktreePath,
      projectPath: '/tmp/my-project',
      branch: spawnedLastRun.branch,
      baseRef: spawnedLastRun.baseRef,
      status: 'running'
    })

    await relaunchedEngine.discoverSessions()

    const sessions = await relaunchedEngine.listSessions()
    expect(sessions).toEqual([
      expect.objectContaining({
        projectId: 'project-1',
        worktreePath: spawnedLastRun.worktreePath,
        branch: spawnedLastRun.branch,
        pid: spawnedLastRun.pid,
        status: 'running'
      })
    ])
  })

  it('carries over a pending prompt reported by Discovery', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateSession({
      pid: 4242,
      cwd: '/tmp/my-project',
      projectPath: '/tmp/my-project',
      branch: 'work-in-progress',
      baseRef: 'abc123',
      status: 'waiting-on-permission',
      pendingPrompt: { type: 'permission', text: 'Run npm install?' }
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const [session] = await engine.discoverSessions()

    expect(session.status).toBe('waiting-on-permission')
    expect(session.pendingPrompt).toEqual({ type: 'permission', text: 'Run npm install?' })
  })

  it('registers a newly discovered active session with the Process adapter, so a later refresh does not mark it errored', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateSession({
      pid: 4242,
      cwd: '/tmp/my-project',
      projectPath: '/tmp/my-project',
      branch: 'work-in-progress',
      baseRef: 'abc123',
      status: 'running'
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await engine.discoverSessions()
    const [session] = await engine.refreshSessionStatuses()

    expect(session.status).toBe('running')
  })

  it('accumulates sessions discovered together with sessions already tracked', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    discovery.simulateSession({
      pid: 9999,
      cwd: '/tmp/my-project',
      projectPath: '/tmp/my-project',
      branch: 'external-branch',
      baseRef: 'abc123',
      status: 'running'
    })

    const sessions = await engine.discoverSessions()

    expect(sessions).toHaveLength(2)
    expect(sessions.some((s) => s.id === spawned.id)).toBe(true)
    expect(sessions.some((s) => s.pid === 9999)).toBe(true)
  })

  it('rediscovers a pid once its old Session has reached a terminal status, rather than treating it as still tracked', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const finished = await engine.spawnSession('project-1')
    processAdapter.simulateExit(finished.pid, 0)
    await engine.refreshSessionStatuses()
    // The OS is free to reissue a dead process's pid - this simulates a
    // brand-new, unrelated externally-started session getting it next.
    discovery.simulateSession({
      pid: finished.pid,
      cwd: '/tmp/my-project',
      projectPath: '/tmp/my-project',
      branch: 'reused-pid-branch',
      baseRef: 'def456',
      status: 'running'
    })

    const sessions = await engine.discoverSessions()

    expect(sessions).toEqual([
      expect.objectContaining({ id: finished.id, status: 'done' }),
      expect.objectContaining({ pid: finished.pid, branch: 'reused-pid-branch', status: 'running' })
    ])
  })
})

describe('Engine.adoptSession', () => {
  it('adds a manually adopted session to an existing Project matched by path', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateManualOnlySession({
      pid: 5150,
      cwd: '/tmp/my-project',
      projectPath: '/tmp/my-project',
      branch: 'manual-branch',
      baseRef: 'abc123',
      status: 'running'
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const session = await engine.adoptSession(5150, '/tmp/my-project')

    expect(session).toEqual({
      id: expect.any(String),
      projectId: 'project-1',
      worktreePath: '/tmp/my-project',
      branch: 'manual-branch',
      baseRef: 'abc123',
      pid: 5150,
      status: 'running',
      pendingPrompt: undefined
    })
  })

  it('surfaces the adopted session through listSessions afterward', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateManualOnlySession({
      pid: 5150,
      cwd: '/tmp/unlisted-project',
      projectPath: '/tmp/unlisted-project',
      branch: 'manual-branch',
      baseRef: 'abc123',
      status: 'idle'
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await engine.adoptSession(5150, '/tmp/unlisted-project')

    await expect(engine.listSessions()).resolves.toEqual([
      expect.objectContaining({ pid: 5150, status: 'idle' })
    ])
  })

  it('creates a new Project when no existing Project matches the resolved project path', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateManualOnlySession({
      pid: 5150,
      cwd: '/tmp/unlisted-project',
      projectPath: '/tmp/unlisted-project',
      branch: 'main',
      baseRef: 'abc123',
      status: 'running'
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const session = await engine.adoptSession(5150, '/tmp/unlisted-project')

    const projects = await engine.listProjects()
    expect(projects).toEqual([
      { id: expect.any(String), path: '/tmp/unlisted-project', name: 'unlisted-project', mergeMode: 'manual' }
    ])
    expect(session.projectId).toBe(projects[0].id)
  })

  it('persists a newly created Project so a fresh Engine sees it too', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateManualOnlySession({
      pid: 5150,
      cwd: '/tmp/unlisted-project',
      projectPath: '/tmp/unlisted-project',
      branch: 'main',
      baseRef: 'abc123',
      status: 'running'
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    await engine.adoptSession(5150, '/tmp/unlisted-project')

    const freshEngine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    await expect(freshEngine.listProjects()).resolves.toHaveLength(1)
  })

  it('carries over a pending prompt reported by the resolved session', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateManualOnlySession({
      pid: 5150,
      cwd: '/tmp/my-project',
      projectPath: '/tmp/my-project',
      branch: 'manual-branch',
      baseRef: 'abc123',
      status: 'waiting-on-permission',
      pendingPrompt: { type: 'permission', text: 'Run npm install?' }
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    const session = await engine.adoptSession(5150, '/tmp/my-project')

    expect(session.status).toBe('waiting-on-permission')
    expect(session.pendingPrompt).toEqual({ type: 'permission', text: 'Run npm install?' })
  })

  it('registers a newly adopted active session with the Process adapter, so a later refresh does not mark it errored', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    discovery.simulateManualOnlySession({
      pid: 5150,
      cwd: '/tmp/my-project',
      projectPath: '/tmp/my-project',
      branch: 'manual-branch',
      baseRef: 'abc123',
      status: 'running'
    })
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await engine.adoptSession(5150, '/tmp/my-project')
    const [session] = await engine.refreshSessionStatuses()

    expect(session.status).toBe('running')
  })

  it('rejects adopting a pid Discovery cannot resolve', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })

    await expect(engine.adoptSession(5150, '/tmp/nowhere')).rejects.toThrow()
    await expect(engine.listSessions()).resolves.toEqual([])
  })

  it('rejects adopting a pid that is already tracked as an active Session', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const spawned = await engine.spawnSession('project-1')
    discovery.simulateManualOnlySession({
      pid: spawned.pid,
      cwd: spawned.worktreePath,
      projectPath: '/tmp/my-project',
      branch: spawned.branch,
      baseRef: spawned.baseRef,
      status: 'running'
    })

    await expect(engine.adoptSession(spawned.pid, spawned.worktreePath)).rejects.toThrow()
    await expect(engine.listSessions()).resolves.toEqual([spawned])
  })

  it('allows re-adopting a pid whose earlier Session has reached a terminal status', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    const finished = await engine.spawnSession('project-1')
    processAdapter.simulateExit(finished.pid, 0)
    await engine.refreshSessionStatuses()
    discovery.simulateManualOnlySession({
      pid: finished.pid,
      cwd: '/tmp/my-project',
      projectPath: '/tmp/my-project',
      branch: 'reused-pid-branch',
      baseRef: 'def456',
      status: 'running'
    })

    const adopted = await engine.adoptSession(finished.pid, '/tmp/my-project')

    expect(adopted.id).not.toBe(finished.id)
    const sessions = await engine.listSessions()
    expect(sessions).toEqual([
      expect.objectContaining({ id: finished.id, status: 'done' }),
      expect.objectContaining({ id: adopted.id, branch: 'reused-pid-branch', status: 'running' })
    ])
  })
})

describe('Engine.spawnSession vs Engine.discoverSessions race', () => {
  it('adopts the Session Discovery already added for a pid, instead of adding a second one', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project', mergeMode: 'manual' as const }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter({ pid: 4242 })
    const notification = createFakeNotificationAdapter()
    const github = createFakeGitHubAdapter()
    const discovery = createFakeDiscoveryAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification, github, discovery })
    // Simulates a discovery scan winning the race and registering the pid
    // spawnSession is about to produce (createFakeProcessAdapter's seed pid)
    // before spawnSession's own write lands.
    discovery.simulateSession({
      pid: 4242,
      cwd: '/tmp/my-project/worktree-1',
      projectPath: '/tmp/my-project',
      branch: 'orca-session-fake-1',
      baseRef: 'base-1',
      status: 'running'
    })
    const discovered = await engine.discoverSessions()

    const spawned = await engine.spawnSession('project-1')

    expect(spawned).toEqual(discovered[0])
    await expect(engine.listSessions()).resolves.toHaveLength(1)
  })
})
