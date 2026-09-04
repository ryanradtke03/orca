import { randomUUID } from 'crypto'
import { basename } from 'path'
import type {
  FileDiff,
  MergeMode,
  MergeResult,
  PingResult,
  Project,
  Session,
  SessionStatus,
  TranscriptMessage,
  TranscriptRole
} from '../../shared/ipc-contract'
import type { EngineAdapters, PullRequestStatus, WorktreeInfo } from './adapters'

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
  getTranscript(sessionId: string): Promise<TranscriptMessage[]>
  setProjectMergeMode(projectId: string, mergeMode: MergeMode): Promise<Project>
  requestMerge(sessionId: string): Promise<MergeResult>
  discoverSessions(): Promise<Session[]>
  discardWorktree(sessionId: string): Promise<Session>
  adoptSession(pid: number, directory: string): Promise<Session>
}

// Sessions whose process is still expected to be running; refreshSessionStatuses
// polls the Process adapter for exactly these, and discoverSessions treats a
// pid as "already tracked" only while its Session is in one of these -
// otherwise the process behind a terminal Session's pid is gone and the OS
// is free to reuse that pid for something unrelated, so it must not block a
// genuinely new discovery.
const ACTIVE_STATUSES: ReadonlySet<Session['status']> = new Set([
  'running',
  'waiting-on-permission',
  'waiting-on-input',
  'idle'
])

// Sessions a message can actually be delivered to via the attach-based write
// path (adapters.process.respond): waiting-on-permission/waiting-on-input
// answer whatever prompt the CLI already captured, while idle has no
// captured prompt at all but is otherwise free to receive its first task.
// 'running' is deliberately excluded - the write path is timing-based, not
// state-verified, and interjecting while the CLI is already mid-task needs
// its own safety pass later; terminal statuses have no process left to
// receive anything.
const RESPONDABLE_STATUSES: ReadonlySet<Session['status']> = new Set([
  'idle',
  'waiting-on-input',
  'waiting-on-permission'
])

export function createEngine(adapters: EngineAdapters): Engine {
  let projects: Project[] | undefined
  let sessions: Session[] = []
  // STUB: replace with real transcript capture (parsing `claude logs <id>`
  // into structured message history) - a follow-up issue's job. Until then,
  // this only ever reflects messages sent through Orca itself, keyed by
  // Session id, never anything the CLI actually said.
  const transcripts = new Map<string, TranscriptMessage[]>()
  // Serializes addProject calls, and reads that must not observe a write mid-flight,
  // so a concurrent read-modify-write can't drop a write or return a stale project list.
  let writeQueue: Promise<unknown> = Promise.resolve()
  // Serializes every read-modify-write of `sessions` (spawn/stop/respond/refresh).
  let sessionsQueue: Promise<unknown> = Promise.resolve()
  // requestMerge/discardWorktree/checkPullRequestMerged all run their (slow,
  // subprocess-backed) worktree I/O outside sessionsQueue, so unrelated
  // sessions' status refreshes aren't blocked behind a single merge/discard -
  // this guards the resource those three actually contend over: a given
  // Session's own worktree. The check-then-add always happens synchronously
  // before either function's first `await`, so two calls racing for the same
  // Session can never both pass it, without needing a queue.
  const worktreeOpInFlight = new Set<string>()

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

  // Matches a discovered/adopted session's project path to an existing
  // Project, or creates one on the fly - shared by discoverSessions and
  // adoptSession, both of which can encounter a path Orca has never seen.
  function findOrCreateProject(
    existingProjects: Project[],
    path: string
  ): { project: Project; projects: Project[] } {
    const found = existingProjects.find((candidate) => candidate.path === path)
    if (found) return { project: found, projects: existingProjects }

    const project: Project = { id: randomUUID(), path, name: basename(path), mergeMode: 'manual' }
    return { project, projects: [...existingProjects, project] }
  }

  function addProject(path: string): Promise<Project> {
    const result = writeQueue.then(async () => {
      const existing = await loadProjects()
      const project: Project = { id: randomUUID(), path, name: basename(path), mergeMode: 'manual' }

      projects = [...existing, project]
      await adapters.persistence.saveProjects(projects)

      return project
    })

    writeQueue = result.catch(() => {})
    return result
  }

  function setProjectMergeMode(projectId: string, mergeMode: MergeMode): Promise<Project> {
    const result = writeQueue.then(async () => {
      const existing = await loadProjects()
      const index = existing.findIndex((candidate) => candidate.id === projectId)
      if (index === -1) {
        throw new Error(`Unknown project: ${projectId}`)
      }

      const updated: Project = { ...existing[index], mergeMode }
      projects = existing.map((candidate, i) => (i === index ? updated : candidate))
      await adapters.persistence.saveProjects(projects)

      return updated
    })

    writeQueue = result.catch(() => {})
    return result
  }

  // Removes a Session's worktree and logs (rather than throws) on failure -
  // most commonly git refusing because it still holds uncommitted/untracked
  // changes, in which case it's left in place rather than losing work. A
  // genuinely unexpected failure (e.g. the Project directory having moved)
  // stays visible in the logs instead of silently leaking disk space forever.
  async function removeWorktreeIfPossible(project: Project, session: Session): Promise<boolean> {
    try {
      await adapters.git.removeWorktree(project.path, session.worktreePath)
      return true
    } catch (error) {
      console.error(`Failed to remove worktree for session ${session.id}:`, error)
      return false
    }
  }

  function markWorktreeRemoved(sessionId: string): Promise<Session> {
    return serializeSessionWrite(async () => {
      let updated: Session | undefined
      sessions = sessions.map((candidate) => {
        if (candidate.id !== sessionId) return candidate
        updated = { ...candidate, worktreeRemoved: true }
        return updated
      })
      // sessionId is always looked up by the caller first, so it's still
      // present here - serializeSessionWrite only reorders concurrent
      // writes, it never drops a session out of the array.
      return updated as Session
    })
  }

  async function requestMerge(sessionId: string): Promise<MergeResult> {
    const session = sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`)
    }

    if (session.status !== 'done') {
      throw new Error(`Session is not finished: ${sessionId}`)
    }

    if (session.worktreeRemoved) {
      throw new Error(`Worktree already removed for session: ${sessionId}`)
    }

    // Claimed synchronously, before any `await` below - so a second
    // concurrent requestMerge/discardWorktree call for the same session
    // (e.g. a double-clicked button) always observes the claim and is
    // rejected, instead of both proceeding to merge/remove the same worktree.
    if (worktreeOpInFlight.has(sessionId)) {
      throw new Error(`A worktree operation is already in progress for session: ${sessionId}`)
    }
    worktreeOpInFlight.add(sessionId)

    try {
      const existing = await loadProjects()
      const project = existing.find((candidate) => candidate.id === session.projectId)
      if (!project) {
        throw new Error(`Unknown project: ${session.projectId}`)
      }

      if (project.mergeMode === 'local-merge') {
        await adapters.git.mergeWorktree({
          projectPath: project.path,
          worktreePath: session.worktreePath,
          branch: session.branch
        })
        // The branch is fully integrated the moment mergeWorktree resolves -
        // nothing left in the worktree is worth reviewing, so it's safe to
        // reclaim right away (unlike Pull request, see below).
        if (await removeWorktreeIfPossible(project, session)) {
          await markWorktreeRemoved(sessionId)
        }
        return { mergeMode: 'local-merge' }
      }

      if (project.mergeMode === 'pull-request') {
        await adapters.git.pushBranch(session.worktreePath, session.branch)
        const { url } = await adapters.github.openPullRequest({
          projectPath: project.path,
          branch: session.branch,
          title: session.branch
        })
        // Opening the PR doesn't integrate the branch yet - refreshSessionStatuses
        // polls it via this URL and reclaims the worktree once GitHub reports
        // it actually merged.
        await serializeSessionWrite(async () => {
          sessions = sessions.map((candidate) =>
            candidate.id === sessionId ? { ...candidate, pullRequestUrl: url } : candidate
          )
        })
        return { mergeMode: 'pull-request', pullRequestUrl: url }
      }

      // Manual: the Diff stays visible for the user to merge themselves - no adapter call.
      return { mergeMode: 'manual' }
    } finally {
      worktreeOpInFlight.delete(sessionId)
    }
  }

  async function discardWorktree(sessionId: string): Promise<Session> {
    const session = sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`)
    }
    if (ACTIVE_STATUSES.has(session.status)) {
      throw new Error(`Session is still active: ${sessionId}`)
    }
    if (session.worktreeRemoved) {
      throw new Error(`Worktree already removed for session: ${sessionId}`)
    }
    if (worktreeOpInFlight.has(sessionId)) {
      throw new Error(`A worktree operation is already in progress for session: ${sessionId}`)
    }
    worktreeOpInFlight.add(sessionId)

    try {
      const existing = await loadProjects()
      const project = existing.find((candidate) => candidate.id === session.projectId)
      if (!project) {
        throw new Error(`Unknown project: ${session.projectId}`)
      }

      // Explicit discard, unlike merge-mode cleanup above: the user is
      // deliberately throwing away unreviewed/unmerged work, so this forces
      // past git's refusal to remove a worktree with outstanding changes.
      // Run outside serializeSessionWrite (unlike stopSession/respondToPrompt)
      // so this subprocess call can't stall unrelated sessions' status
      // refreshes - only the final, near-instant array update needs the queue.
      await adapters.git.discardWorktree(project.path, session.worktreePath)

      return await markWorktreeRemoved(sessionId)
    } finally {
      worktreeOpInFlight.delete(sessionId)
    }
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
      // A concurrent discoverSessions scan can observe this same pid (once
      // the CLI itself registers it) before this write lands, and add it
      // first - if so, adopt that record rather than adding a second
      // Session for one physical process.
      const alreadyDiscovered = sessions.find((candidate) => candidate.pid === pid)
      if (alreadyDiscovered) return alreadyDiscovered

      // adapters.process.spawnClaude starts the CLI bare, with no initial
      // task (#44/#45) - it genuinely has nothing to do until Orca's own UI
      // sends it one via respondToPrompt, so 'idle' (not 'running') is the
      // only accurate initial status.
      const session: Session = {
        id: randomUUID(),
        projectId,
        worktreePath,
        branch,
        baseRef,
        pid,
        status: 'idle'
      }
      sessions = [...sessions, session]

      return session
    })
  }

  async function getDiff(sessionId: string): Promise<FileDiff[]> {
    const session = sessions.find((candidate) => candidate.id === sessionId)
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`)
    }
    if (session.worktreeRemoved) {
      throw new Error(`Worktree already removed for session: ${sessionId}`)
    }

    return adapters.git.getDiff(session.worktreePath, session.baseRef)
  }

  // Pull request Merge mode leaves a Session's worktree in place after
  // requestMerge, since opening a PR doesn't integrate the branch - only
  // GitHub actually merging it does. Called once per refresh for every
  // non-active Session with an open PR still tracked, so the worktree is
  // reclaimed once that eventually happens.
  async function checkPullRequestMerged(session: Session): Promise<Session> {
    if (!session.pullRequestUrl || session.worktreeRemoved) return session
    // A concurrent requestMerge/discardWorktree call already owns this
    // Session's worktree - skip it this tick and check again on the next.
    if (worktreeOpInFlight.has(session.id)) return session

    let status: PullRequestStatus
    try {
      status = await adapters.github.getPullRequestStatus(session.pullRequestUrl)
    } catch (error) {
      // A blip (gh unauthenticated, GitHub unreachable, PR deleted) shouldn't
      // fail the whole refresh cycle - every other session's status update
      // in the same Promise.all would be lost too. Just retry next tick.
      console.error(`Failed to check pull request status for session ${session.id}:`, error)
      return session
    }
    if (status !== 'merged') return session

    const existing = await loadProjects()
    const project = existing.find((candidate) => candidate.id === session.projectId)
    if (!project) return session

    worktreeOpInFlight.add(session.id)
    try {
      const removed = await removeWorktreeIfPossible(project, session)
      return removed ? { ...session, worktreeRemoved: true } : session
    } finally {
      worktreeOpInFlight.delete(session.id)
    }
  }

  function refreshSessionStatuses(): Promise<Session[]> {
    return serializeSessionWrite(async () => {
      sessions = await Promise.all(
        sessions.map(async (session) => {
          if (!ACTIVE_STATUSES.has(session.status)) {
            return checkPullRequestMerged(session)
          }

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

  function appendTranscriptMessage(sessionId: string, role: TranscriptRole, text: string): void {
    const existing = transcripts.get(sessionId) ?? []
    transcripts.set(sessionId, [...existing, { id: randomUUID(), role, text, timestamp: Date.now() }])
  }

  function respondToPrompt(sessionId: string, response: string): Promise<Session> {
    return serializeSessionWrite(async () => {
      const session = sessions.find((candidate) => candidate.id === sessionId)
      if (!session) {
        throw new Error(`Unknown session: ${sessionId}`)
      }
      if (!RESPONDABLE_STATUSES.has(session.status)) {
        throw new Error(`Session cannot receive a message right now: ${sessionId}`)
      }

      await adapters.process.respond(session.pid, response)
      appendTranscriptMessage(sessionId, 'user', response)

      const updated: Session = { ...session, status: 'running', pendingPrompt: undefined }
      sessions = sessions.map((candidate) => (candidate.id === sessionId ? updated : candidate))
      return updated
    })
  }

  async function getTranscript(sessionId: string): Promise<TranscriptMessage[]> {
    if (!sessions.some((candidate) => candidate.id === sessionId)) {
      throw new Error(`Unknown session: ${sessionId}`)
    }
    return transcripts.get(sessionId) ?? []
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

  // Finds Claude Code CLI sessions Discovery can see that this Engine
  // doesn't already track by pid - whether they were started outside Orca
  // entirely, or were spawned/discovered in a previous run of Orca and are
  // simply new to *this* in-memory session list (ADR-0002: nothing about a
  // Session survives an Orca restart except the process itself, so a
  // relaunch rediscovers it exactly like one Orca never knew about).
  // Deliberately leaves already-tracked sessions' status alone -
  // refreshSessionStatuses owns keeping those current via the Process
  // adapter; this only ever adds newly-found ones.
  function discoverSessions(): Promise<Session[]> {
    const result = writeQueue.then(async () => {
      const discovered = await adapters.discovery.scan()

      await serializeSessionWrite(async () => {
        // Only an active Session's pid counts as "already tracked" - once a
        // Session reaches a terminal status its process is gone, and the OS
        // is free to hand that same pid to an unrelated later process, so a
        // stale terminal Session must not block discovering it.
        const untracked = discovered.filter(
          (entry) =>
            !sessions.some((session) => session.pid === entry.pid && ACTIVE_STATUSES.has(session.status))
        )
        if (untracked.length === 0) return

        const existingProjects = await loadProjects()
        let updatedProjects = existingProjects
        const newSessions: Session[] = []

        for (const entry of untracked) {
          // Only an active entry needs to be pollable going forward -
          // refreshSessionStatuses never calls isAlive for a terminal one
          // (see checkPullRequestMerged), and the real Process adapter can't
          // always confirm a session that's already finished is still
          // listed, so skipping this for those avoids dropping an otherwise
          // valid discovered entry over a registration failure that doesn't
          // matter for it.
          if (ACTIVE_STATUSES.has(entry.status)) {
            try {
              await adapters.process.registerAlive(entry.pid)
            } catch (error) {
              console.error(`Failed to register discovered session pid ${entry.pid} as alive:`, error)
              continue
            }
          }

          const { project, projects: nextProjects } = findOrCreateProject(updatedProjects, entry.projectPath)
          updatedProjects = nextProjects

          newSessions.push({
            id: randomUUID(),
            projectId: project.id,
            worktreePath: entry.cwd,
            branch: entry.branch,
            baseRef: entry.baseRef,
            pid: entry.pid,
            status: entry.status,
            pendingPrompt: entry.pendingPrompt
          })
        }

        if (updatedProjects !== existingProjects) {
          projects = updatedProjects
          await adapters.persistence.saveProjects(projects)
        }

        sessions = [...sessions, ...newSessions]
      })
    })

    writeQueue = result.catch(() => {})
    return result.then(() => sessions)
  }

  // The manual fallback for a session Discovery hasn't (or can't) pick up on
  // its own - the user identifies it by pid and working directory, and the
  // Discovery adapter resolves the rest (project path, branch, status) from
  // there, exactly as discoverSessions does for an automatically-found one.
  function adoptSession(pid: number, directory: string): Promise<Session> {
    const result = writeQueue.then(async () => {
      if (sessions.some((session) => session.pid === pid && ACTIVE_STATUSES.has(session.status))) {
        throw new Error(`Session already tracked: pid ${pid}`)
      }

      const resolved = await adapters.discovery.resolveManual(pid, directory)
      if (!resolved) {
        throw new Error(`No running Claude Code session found for pid ${pid} in ${directory}`)
      }

      // Makes the adopted pid pollable by refreshSessionStatuses going
      // forward, exactly like a spawned session's - skipped for an
      // already-terminal one, which refreshSessionStatuses never calls
      // isAlive for anyway (see checkPullRequestMerged).
      if (ACTIVE_STATUSES.has(resolved.status)) {
        await adapters.process.registerAlive(resolved.pid)
      }

      return serializeSessionWrite(async () => {
        // Re-checked after the await above, same as spawnSession/discoverSessions -
        // a concurrent adopt/discover for this pid could have landed first.
        if (sessions.some((session) => session.pid === resolved.pid && ACTIVE_STATUSES.has(session.status))) {
          throw new Error(`Session already tracked: pid ${resolved.pid}`)
        }

        const existingProjects = await loadProjects()
        const { project, projects: nextProjects } = findOrCreateProject(existingProjects, resolved.projectPath)
        if (nextProjects !== existingProjects) {
          projects = nextProjects
          await adapters.persistence.saveProjects(projects)
        }

        const session: Session = {
          id: randomUUID(),
          projectId: project.id,
          worktreePath: resolved.cwd,
          branch: resolved.branch,
          baseRef: resolved.baseRef,
          pid: resolved.pid,
          status: resolved.status,
          pendingPrompt: resolved.pendingPrompt
        }
        sessions = [...sessions, session]

        return session
      })
    })

    writeQueue = result.catch(() => {})
    return result
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
    getDiff,
    getTranscript,
    setProjectMergeMode,
    requestMerge,
    discoverSessions,
    discardWorktree,
    adoptSession
  }
}
