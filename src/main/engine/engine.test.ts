import { describe, expect, it } from 'vitest'
import { createEngine } from './engine'
import { createFakeGitAdapter } from './fake-git-adapter'
import { createFakeNotificationAdapter } from './fake-notification-adapter'
import { createFakePersistenceAdapter } from './fake-persistence-adapter'
import { createFakeProcessAdapter } from './fake-process-adapter'

describe('Engine.ping', () => {
  it('reports ok status and the session count from the persistence adapter', async () => {
    const persistence = createFakePersistenceAdapter({ sessionCount: 3 })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    const result = await engine.ping()

    expect(result).toEqual({ ok: true, sessionCount: 3 })
  })

  it('defaults to zero sessions when nothing has been persisted', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    await expect(engine.listProjects()).resolves.toEqual([])
  })

  it('returns projects loaded from the persistence adapter', async () => {
    const seeded = [{ id: '1', path: '/tmp/foo', name: 'foo' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    await expect(engine.listProjects()).resolves.toEqual(seeded)
  })
})

describe('Engine.addProject', () => {
  it('adds a project derived from the given path and returns it', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    const project = await engine.addProject('/tmp/my-project')

    expect(project).toMatchObject({ path: '/tmp/my-project', name: 'my-project' })
    expect(project.id).toEqual(expect.any(String))
  })

  it('assigns each added project a distinct id', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    const first = await engine.addProject('/tmp/one')
    const second = await engine.addProject('/tmp/two')

    expect(first.id).not.toBe(second.id)
  })

  it('appends to, rather than replaces, previously persisted projects', async () => {
    const seeded = [{ id: '1', path: '/tmp/foo', name: 'foo' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    await engine.addProject('/tmp/my-project')

    const freshEngine = createEngine({ persistence, git, process: processAdapter, notification })
    await expect(freshEngine.listProjects()).resolves.toHaveLength(1)
  })

  it('does not drop a project when two adds race', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    const session = await engine.spawnSession('project-1')

    await expect(engine.listSessions()).resolves.toEqual([session])
  })

  it('rejects when the project id is unknown', async () => {
    const persistence = createFakePersistenceAdapter()
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    await expect(engine.spawnSession('missing')).rejects.toThrow('Unknown project: missing')
  })

  it('accumulates multiple sessions across multiple spawns', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    await expect(engine.listSessions()).resolves.toEqual([])
  })

  it('reports a freshly spawned session as running', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    const session = await engine.spawnSession('project-1')

    expect(session.status).toBe('running')
  })
})

describe('Engine.stopSession', () => {
  async function spawnRunningSession(processAdapter = createFakeProcessAdapter()) {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })
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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    await expect(engine.stopSession('missing')).rejects.toThrow('Unknown session: missing')
  })

  it('does not affect other sessions', async () => {
    const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
  const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]

  it('leaves a session running while its process is still alive, without notifying', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
  const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]

  it('forwards the response to the Process adapter for the session', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    await expect(engine.respondToPrompt('missing', 'yes')).rejects.toThrow(
      'Unknown session: missing'
    )
  })

  it('rejects when the session has no pending prompt', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    const spawned = await engine.spawnSession('project-1')

    await expect(engine.respondToPrompt(spawned.id, 'yes')).rejects.toThrow(
      `Session has no pending prompt: ${spawned.id}`
    )
  })
})

describe('Engine.getDiff', () => {
  const seeded = [{ id: 'project-1', path: '/tmp/my-project', name: 'my-project' }]

  it("delegates to the Git adapter with the session's worktree path and base ref", async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })
    const spawned = await engine.spawnSession('project-1')

    await engine.getDiff(spawned.id)

    expect(git.getDiffCalls).toEqual([{ worktreePath: spawned.worktreePath, baseRef: spawned.baseRef }])
  })

  it('returns the file diffs reported by the Git adapter', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })
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
    const engine = createEngine({ persistence, git, process: processAdapter, notification })

    await expect(engine.getDiff('missing')).rejects.toThrow('Unknown session: missing')
  })

  it('keeps diffing against the same base ref even after the session finishes', async () => {
    const persistence = createFakePersistenceAdapter({ projects: seeded })
    const git = createFakeGitAdapter()
    const processAdapter = createFakeProcessAdapter()
    const notification = createFakeNotificationAdapter()
    const engine = createEngine({ persistence, git, process: processAdapter, notification })
    const spawned = await engine.spawnSession('project-1')
    processAdapter.simulateExit(spawned.pid, 0)
    await engine.refreshSessionStatuses()

    await engine.getDiff(spawned.id)

    expect(git.getDiffCalls).toEqual([{ worktreePath: spawned.worktreePath, baseRef: spawned.baseRef }])
  })
})
