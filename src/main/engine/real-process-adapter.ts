import { execFile } from 'child_process'
import { promisify } from 'util'
import * as pty from 'node-pty'
import type { PendingPrompt, ProcessAdapter, ProcessInfo } from './adapters'
import { createAgentStatusLister, promptTypeFromStatus, type ListAgentStatuses } from './agent-status'
import { extractPromptText, renderScreen } from './prompt-text'

const execFileAsync = promisify(execFile)

const POLL_INTERVAL_MS = 300
const RESOLVE_PID_TIMEOUT_MS = 5000
const RESOLVE_PID_RETRY_MS = 100

// The CLI prints this line (and exits immediately) once a background session
// is up: `backgrounded · <id>`.
const BACKGROUNDED_ID_PATTERN = /backgrounded\s*\S\s*(\S+)/

// A background session's underlying process is owned by the CLI's own
// background service (ADR 0002: it must survive Orca quitting), not by Orca
// directly - a plain node-pty spawn dies with its holder process, so it
// can't be used for the session itself. node-pty is only used for the
// short-lived `attach` we open to deliver a response (see respond()); that
// attach can safely die with Orca, since it isn't what keeps the session alive.
interface TrackedSession {
  id: string
  pid: number
  alive: boolean
  exitCode: number | null
  pendingPrompt: PendingPrompt | null
}

export function createRealProcessAdapter(
  command = 'claude',
  args: string[] = [],
  listAgentStatuses: ListAgentStatuses = createAgentStatusLister(command)
): ProcessAdapter {
  const sessions = new Map<number, TrackedSession>()

  async function refreshPendingPrompt(tracked: TrackedSession, waitingFor: string | undefined): Promise<void> {
    const type = promptTypeFromStatus({ status: 'waiting', waitingFor })
    if (!type) {
      tracked.pendingPrompt = null
      return
    }

    const stdout = await execFileAsync(command, ['logs', tracked.id])
      .then((result) => result.stdout)
      .catch(() => '')
    const lines = await renderScreen(stdout)
    const text = extractPromptText(lines)
    tracked.pendingPrompt = text ? { type, text } : null
  }

  async function poll(): Promise<void> {
    if (sessions.size === 0) return

    const statuses = await listAgentStatuses()
    const byId = new Map(statuses.map((entry) => [entry.id, entry]))

    for (const tracked of sessions.values()) {
      if (!tracked.alive) continue
      const entry = byId.get(tracked.id)

      // Once a session's underlying process is gone - it finished, crashed,
      // or was stopped - the CLI keeps a stub entry around (for `claude rm`)
      // but drops its `pid`.
      if (!entry || entry.pid === undefined) {
        tracked.alive = false
        tracked.exitCode = entry?.state === 'done' ? 0 : 1
        tracked.pendingPrompt = null
        continue
      }

      if (entry.status === 'waiting') {
        await refreshPendingPrompt(tracked, entry.waitingFor)
      } else {
        tracked.pendingPrompt = null
      }
    }
  }

  const pollTimer = setInterval(() => {
    void poll()
  }, POLL_INTERVAL_MS)
  pollTimer.unref()

  // The background service takes a moment to register a just-spawned session
  // after `--bg` prints its id and returns, so the first `agents` listing
  // right after spawn can still miss it.
  async function resolvePid(id: string): Promise<number> {
    const deadline = Date.now() + RESOLVE_PID_TIMEOUT_MS
    for (;;) {
      const statuses = await listAgentStatuses()
      const pid = statuses.find((entry) => entry.id === id)?.pid
      if (pid !== undefined) return pid

      if (Date.now() >= deadline) {
        throw new Error(`Spawned background session "${id}" is not listed by \`claude agents\``)
      }
      await new Promise((resolve) => setTimeout(resolve, RESOLVE_PID_RETRY_MS))
    }
  }

  return {
    async spawnClaude(cwd: string): Promise<ProcessInfo> {
      const { stdout } = await execFileAsync(command, [...args, '--bg'], { cwd })
      const match = BACKGROUNDED_ID_PATTERN.exec(stdout)
      if (!match) {
        throw new Error(`Could not parse a background session id from: ${stdout}`)
      }
      const id = match[1]
      const pid = await resolvePid(id)

      sessions.set(pid, { id, pid, alive: true, exitCode: null, pendingPrompt: null })
      return { pid }
    },

    async stop(pid: number): Promise<void> {
      const tracked = sessions.get(pid)
      if (!tracked) return
      await execFileAsync(command, ['stop', tracked.id]).catch(() => {})
    },

    isAlive(pid: number): boolean {
      return sessions.get(pid)?.alive ?? false
    },

    exitCode(pid: number): number | null {
      return sessions.get(pid)?.exitCode ?? null
    },

    pendingPrompt(pid: number): PendingPrompt | null {
      return sessions.get(pid)?.pendingPrompt ?? null
    },

    async respond(pid: number, response: string): Promise<void> {
      const tracked = sessions.get(pid)
      if (!tracked) return

      await new Promise<void>((resolve, reject) => {
        const child = pty.spawn(command, ['attach', tracked.id], { cols: 220, rows: 60 })
        let wrote = false

        child.onData(() => {
          if (wrote) return
          wrote = true
          // Give the TUI a moment to finish rendering after "Attaching…"
          // before it can reliably accept a keypress.
          setTimeout(() => {
            child.write(`${response}\r`)
            setTimeout(() => {
              child.kill()
              resolve()
            }, 300)
          }, 200)
        })

        child.onExit(({ exitCode }) => {
          if (!wrote) reject(new Error(`attach for session "${tracked.id}" exited before accepting input (code ${exitCode})`))
        })
      })

      tracked.pendingPrompt = null
    }
  }
}
