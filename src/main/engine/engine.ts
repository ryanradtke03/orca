import { randomUUID } from 'crypto'
import { basename } from 'path'
import type { PingResult, Project, Session } from '../../shared/ipc-contract'
import type { EngineAdapters, WorktreeInfo } from './adapters'

export interface Engine {
  ping(): Promise<PingResult>
  listProjects(): Promise<Project[]>
  addProject(path: string): Promise<Project>
  createWorktree(projectPath: string): Promise<WorktreeInfo>
  spawnSession(projectId: string): Promise<Session>
  listSessions(): Promise<Session[]>
  refreshSessionStatuses(): Promise<Session[]>
  stopSession(sessionId: string): Promise<Session>
}

export function createEngine(adapters: EngineAdapters): Engine {
  let projects: Project[] | undefined
  let sessions: Session[] = []
  // Serializes addProject calls, and reads that must not observe a write mid-flight,
  // so a concurrent read-modify-write can't drop a write or return a stale project list.
  let writeQueue: Promise<unknown> = Promise.resolve()

  async function loadProjects(): Promise<Project[]> {
    if (!projects) {
      projects = await adapters.persistence.loadProjects()
    }
    return projects
  }

  function addProject(path: string): Promise<Project> {
    const result = writeQueue.then(async () => {
      const existing = await loadProjects()
      const project: Project = { id: randomUUID(), path, name: basename(path) }

      projects = [...existing, project]
      await adapters.persistence.saveProjects(projects)

      return project
    })

    writeQueue = result.catch(() => {})
    return result
  }

  async function spawnSession(projectId: string): Promise<Session> {
    await writeQueue
    const existing = await loadProjects()
    const project = existing.find((candidate) => candidate.id === projectId)
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`)
    }

    const { worktreePath, branch } = await adapters.git.createWorktree(project.path)
    const { pid } = await adapters.process.spawnClaude(worktreePath)

    const session: Session = {
      id: randomUUID(),
      projectId,
      worktreePath,
      branch,
      pid,
      status: 'running'
    }
    sessions = [...sessions, session]

    return session
  }

  function refreshSessionStatuses(): Promise<Session[]> {
    sessions = sessions.map((session) => {
      if (session.status !== 'running') return session
      if (adapters.process.isAlive(session.pid)) return session

      const exitCode = adapters.process.exitCode(session.pid)
      if (exitCode === 0) {
        adapters.notification.notify({
          title: 'Session finished',
          body: `${session.branch} finished successfully.`,
          urgency: 'low'
        })
        return { ...session, status: 'done' }
      }

      adapters.notification.notify({
        title: 'Session errored',
        body: `${session.branch} exited unexpectedly.`,
        urgency: 'critical'
      })
      return { ...session, status: 'errored' }
    })

    return Promise.resolve(sessions)
  }

  async function stopSession(sessionId: string): Promise<Session> {
    const session = sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`)
    }

    await adapters.process.stop(session.pid)

    const stopped: Session = { ...session, status: 'stopped' }
    sessions = sessions.map((candidate) => (candidate.id === sessionId ? stopped : candidate))

    return stopped
  }

  return {
    async ping() {
      const sessionCount = await adapters.persistence.loadSessionCount()
      return { ok: true, sessionCount }
    },
    async listProjects() {
      return loadProjects()
    },
    addProject,
    async createWorktree(projectPath: string) {
      return adapters.git.createWorktree(projectPath)
    },
    spawnSession,
    async listSessions() {
      return sessions
    },
    refreshSessionStatuses,
    stopSession
  }
}
