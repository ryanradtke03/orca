import { randomUUID } from 'crypto'
import { basename } from 'path'
import type { FileDiff, PingResult, Project, Session, SessionStatus } from '../../shared/ipc-contract'
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
  respondToPrompt(sessionId: string, response: string): Promise<Session>
  getDiff(sessionId: string): Promise<FileDiff[]>
}

// Sessions whose process is still expected to be running; refreshSessionStatuses
// polls the Process adapter for exactly these.
const ACTIVE_STATUSES: ReadonlySet<Session['status']> = new Set([
  'running',
  'waiting-on-permission',
  'waiting-on-input'
])

export function createEngine(adapters: EngineAdapters): Engine {
  let projects: Project[] | undefined
  let sessions: Session[] = []
  // The commit each session's worktree branch forked from, so getDiff knows
  // what to diff against. Keyed separately from Session (rather than added to
  // it) since it's Git-adapter bookkeeping, not something the renderer needs.
  const worktreeBaseRefs = new Map<string, string>()
  // Serializes addProject calls, and reads that must not observe a write mid-flight,
  // so a concurrent read-modify-write can't drop a write or return a stale project list.
  let writeQueue: Promise<unknown> = Promise.resolve()
  // Serializes every read-modify-write of `sessions` (spawn/stop/respond/refresh).
  let sessionsQueue: Promise<unknown> = Promise.resolve()

  function serializeSessionWrite<T>(fn: () => Promise<T>): Promise<T> {
    const result = sessionsQueue.then(fn)
    sessionsQueue = result.then(
      () => {},
      () => {}
    )
    return result
  }

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

    const { worktreePath, branch, baseRef } = await adapters.git.createWorktree(project.path)
    const { pid } = await adapters.process.spawnClaude(worktreePath)

    return serializeSessionWrite(async () => {
      const session: Session = {
        id: randomUUID(),
        projectId,
        worktreePath,
        branch,
        pid,
        status: 'running'
      }
      sessions = [...sessions, session]
      worktreeBaseRefs.set(session.id, baseRef)

      return session
    })
  }

  async function getDiff(sessionId: string): Promise<FileDiff[]> {
    const session = sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`)
    }
    const baseRef = worktreeBaseRefs.get(sessionId)
    if (!baseRef) {
      throw new Error(`No base ref recorded for session: ${sessionId}`)
    }

    return adapters.git.getDiff(session.worktreePath, baseRef)
  }

  function refreshSessionStatuses(): Promise<Session[]> {
    return serializeSessionWrite(async () => {
      sessions = await Promise.all(
        sessions.map(async (session) => {
          if (!ACTIVE_STATUSES.has(session.status)) return session

          if (!adapters.process.isAlive(session.pid)) {
            const exitCode = adapters.process.exitCode(session.pid)
            const terminal: Session =
              exitCode === 0
                ? { ...session, status: 'done', pendingPrompt: undefined }
                : { ...session, status: 'errored', pendingPrompt: undefined }

            adapters.notification.notify(
              exitCode === 0
                ? {
                    title: 'Session finished',
                    body: `${session.branch} finished successfully.`,
                    urgency: 'low'
                  }
                : {
                    title: 'Session errored',
                    body: `${session.branch} exited unexpectedly.`,
                    urgency: 'critical'
                  }
            )
            return terminal
          }

          const prompt = adapters.process.pendingPrompt(session.pid)
          if (!prompt) {
            if (session.pendingPrompt) {
              return { ...session, status: 'running', pendingPrompt: undefined }
            }
            return session
          }

          const status: SessionStatus =
            prompt.type === 'permission' ? 'waiting-on-permission' : 'waiting-on-input'
          const alreadyShown =
            session.status === status && session.pendingPrompt?.text === prompt.text
          if (alreadyShown) return session

          adapters.notification.notify({
            title:
              prompt.type === 'permission' ? 'Session needs permission' : 'Session needs input',
            body: `${session.branch} is waiting on you.`,
            urgency: 'critical'
          })
          return { ...session, status, pendingPrompt: prompt }
        })
      )

      return sessions
    })
  }

  function respondToPrompt(sessionId: string, response: string): Promise<Session> {
    return serializeSessionWrite(async () => {
      const session = sessions.find((candidate) => candidate.id === sessionId)
      if (!session) {
        throw new Error(`Unknown session: ${sessionId}`)
      }
      if (!session.pendingPrompt) {
        throw new Error(`Session has no pending prompt: ${sessionId}`)
      }

      await adapters.process.respond(session.pid, response)

      const updated: Session = { ...session, status: 'running', pendingPrompt: undefined }
      sessions = sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate))
      return updated
    })
  }

  function stopSession(sessionId: string): Promise<Session> {
    return serializeSessionWrite(async () => {
      const session = sessions.find((candidate) => candidate.id === sessionId)
      if (!session) {
        throw new Error(`Unknown session: ${sessionId}`)
      }

      await adapters.process.stop(session.pid)

      const stopped: Session = { ...session, status: 'stopped', pendingPrompt: undefined }
      sessions = sessions.map((candidate) => (candidate.id === sessionId ? stopped : candidate))

      return stopped
    })
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
    stopSession,
    respondToPrompt,
    getDiff
  }
}
