import type {
  FileDiff,
  MergeResult,
  OrcaApi,
  PingResult,
  Project,
  Session,
  TranscriptMessage
} from '../../../shared/ipc-contract'
import { BASE_REF, cloneFixtures, MOCK_PROJECTS, type MockSessionFixture } from './fixtures'
import type { MockSession } from './placeholder-types'
import { isTerminalStatus } from '../view-models/session'

/** Dev-only controls the mock exposes on top of the real OrcaApi surface. */
export interface MockControls {
  isHomeEmpty(): boolean
  /** Flips Home between its populated and empty states with no restart (ticket #49). */
  setHomeEmpty(empty: boolean): void
}

export interface MockOrca {
  api: OrcaApi
  controls: MockControls
}

/** A fresh idle Session with no changes yet - what spawn and adopt both produce. */
function newBlankFixture(fields: {
  id: string
  projectId: string
  worktreePath: string
  branch: string
  pid: number
}): MockSessionFixture {
  return {
    session: { ...fields, baseRef: BASE_REF, status: 'idle', additions: 0, deletions: 0, fileCount: 0 },
    diff: [],
    transcript: []
  }
}

/**
 * A fake `window.orca` backed by in-memory fixtures (docs/mockups/). It
 * implements the full IPC contract so the existing screens render and every
 * action clicks through against mutable state, and adds dev-only controls
 * (the Home populated/empty toggle). Gated behind VITE_ORCA_MOCK - the real
 * IPC path is untouched.
 */
export function createMockOrca(): MockOrca {
  const projects: Project[] = structuredClone(MOCK_PROJECTS)
  const fixtures = cloneFixtures()
  const byId = new Map<string, MockSessionFixture>(fixtures.map((fixture) => [fixture.session.id, fixture]))
  let homeEmpty = false

  function requireFixture(sessionId: string): MockSessionFixture {
    const fixture = byId.get(sessionId)
    if (!fixture) throw new Error(`Unknown session: ${sessionId}`)
    return fixture
  }

  // Hand back a shallow copy so callers can't mutate the store by reference -
  // the real IPC path returns fresh objects deserialized over the bridge. The
  // rich transcript (tool calls + permission card) rides along on the session
  // so the session screen (05b) can render it; getTranscript still narrows to
  // plain messages for the contract shape live mode consumes.
  function snapshot(fixture: MockSessionFixture): Session {
    const session: MockSession = { ...fixture.session, transcript: fixture.transcript }
    return session
  }

  function addFixture(fixture: MockSessionFixture): Session {
    fixtures.push(fixture)
    byId.set(fixture.session.id, fixture)
    return snapshot(fixture)
  }

  const api: OrcaApi = {
    async ping(): Promise<PingResult> {
      return { ok: true, sessionCount: homeEmpty ? 0 : fixtures.length }
    },

    async listProjects(): Promise<Project[]> {
      return homeEmpty ? [] : projects.map((project) => ({ ...project }))
    },

    async addProjectViaDialog(): Promise<Project | null> {
      // No file dialog in mock mode - the toggle is the way to leave the empty state.
      return null
    },

    async spawnSession(projectId: string): Promise<Session> {
      const id = `sess-mock-${Math.random().toString(36).slice(2, 6)}`
      return addFixture(
        newBlankFixture({
          id,
          projectId,
          worktreePath: `~/.orca/${id}`,
          branch: id.replace('sess-', 'session-'),
          pid: 5000 + fixtures.length
        })
      )
    },

    async listSessions(): Promise<Session[]> {
      return homeEmpty ? [] : fixtures.map(snapshot)
    },

    async refreshSessionStatuses(): Promise<Session[]> {
      return homeEmpty ? [] : fixtures.map(snapshot)
    },

    async stopSession(sessionId: string): Promise<Session> {
      const fixture = requireFixture(sessionId)
      fixture.session.status = 'stopped'
      fixture.session.pendingPrompt = undefined
      return snapshot(fixture)
    },

    // The response text is ignored in mock mode - a fewer-arg signature still
    // satisfies OrcaApi's respondToPrompt(sessionId, response).
    async respondToPrompt(sessionId: string): Promise<Session> {
      const fixture = requireFixture(sessionId)
      // Answering a prompt (approve/deny/reply) or messaging an idle session
      // sends the session back to work - mirrors the engine's behaviour.
      fixture.session.pendingPrompt = undefined
      fixture.session.status = 'running'
      return snapshot(fixture)
    },

    async getDiff(sessionId: string): Promise<FileDiff[]> {
      return requireFixture(sessionId).diff.map((file) => ({ ...file }))
    },

    async getTranscript(sessionId: string): Promise<TranscriptMessage[]> {
      // Narrow the rich fixture transcript back to the contract shape the
      // existing chat pane consumes; tool calls / permission cards are carried
      // for the expanded screen ticket, not this one.
      return requireFixture(sessionId)
        .transcript.filter((entry) => entry.kind === 'message')
        .map((entry) => ({ ...entry.message }))
    },

    async setProjectMergeMode(projectId, mergeMode): Promise<Project> {
      const project = projects.find((candidate) => candidate.id === projectId)
      if (!project) throw new Error(`Unknown project: ${projectId}`)
      project.mergeMode = mergeMode
      return { ...project }
    },

    async requestMerge(sessionId: string): Promise<MergeResult> {
      const fixture = requireFixture(sessionId)
      const project = projects.find((candidate) => candidate.id === fixture.session.projectId)
      const mergeMode = project?.mergeMode ?? 'manual'
      if (mergeMode === 'pull-request') {
        const pullRequestUrl = `https://github.com/example/${project?.name ?? 'repo'}/pull/42`
        fixture.session.pullRequestUrl = pullRequestUrl
        return { mergeMode, pullRequestUrl }
      }
      if (mergeMode === 'local-merge') {
        fixture.session.worktreeRemoved = true
        return { mergeMode }
      }
      return { mergeMode }
    },

    async discardWorktree(sessionId: string): Promise<Session> {
      const fixture = requireFixture(sessionId)
      fixture.session.worktreeRemoved = true
      return snapshot(fixture)
    },

    async adoptSession(pid: number, directory: string): Promise<Session> {
      // Mirror the engine's guard so the "already tracked" error path is
      // reachable in mock mode too - a pid already backing an active session
      // can't be adopted again.
      if (fixtures.some((fixture) => fixture.session.pid === pid && !isTerminalStatus(fixture.session.status))) {
        throw new Error(`Session already tracked: pid ${pid}`)
      }
      return addFixture(
        newBlankFixture({
          id: `sess-adopt-${pid}`,
          projectId: projects[0]?.id ?? 'proj-orca',
          worktreePath: directory,
          branch: `adopted-${pid}`,
          pid
        })
      )
    }
  }

  const controls: MockControls = {
    isHomeEmpty: () => homeEmpty,
    setHomeEmpty: (empty: boolean) => {
      homeEmpty = empty
    }
  }

  return { api, controls }
}
