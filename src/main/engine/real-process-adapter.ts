import { execFile } from 'child_process'
import { promisify } from 'util'
import * as pty from 'node-pty'
import type { PendingPrompt, ProcessAdapter, ProcessInfo } from './adapters'
import {
  createAgentStatusLister,
  promptTypeFromStatus,
  type AgentStatusEntry,
  type ListAgentStatuses
} from './agent-status'
import { extractPromptText, renderScreen, TERMINAL_COLS, TERMINAL_ROWS } from './prompt-text'

const execFileAsync = promisify(execFile)

const POLL_INTERVAL_MS = 300
const RESOLVE_PID_TIMEOUT_MS = 5000
const RESOLVE_PID_RETRY_MS = 100
const RESPOND_TIMEOUT_MS = 5000

// The CLI prints this line (and exits immediately) once a background session
// is up: `backgrounded · <id>`. There's no structured (--json) form of this
// specific announcement to parse instead - `agents --json` lists sessions
// that already exist, but doesn't cover the one `--bg` itself just created.
const BACKGROUNDED_ID_PATTERN = /backgrounded\s*\S\s*([0-9a-f]{4,})/i

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

  // Only re-fetches and re-renders the screen when the prompt's category
  // actually changed - otherwise every 300ms tick would re-run `claude logs`
  // and rebuild a terminal emulator for every waiting session indefinitely,
  // just to reconfirm a dialog that hasn't changed.
  async function refreshPendingPrompt(tracked: TrackedSession, waitingFor: string | undefined): Promise<void> {
    const type = promptTypeFromStatus({ status: 'waiting', waitingFor })
    if (!type) {
      tracked.pendingPrompt = null
      return
    }
    if (tracked.pendingPrompt?.type === type) return

    let stdout: string
    try {
      stdout = (await execFileAsync(command, ['logs', tracked.id])).stdout
    } catch {
      // Leave whatever pendingPrompt we already had - a transient `claude
      // logs` failure isn't evidence the prompt went away.
      return
    }
    const lines = await renderScreen(stdout)
    const text = extractPromptText(lines)
    if (text) tracked.pendingPrompt = { type, text }
  }

  let pollInFlight = false

  async function poll(): Promise<void> {
    if (sessions.size === 0 || pollInFlight) return
    pollInFlight = true
    try {
      let statuses: AgentStatusEntry[]
      try {
        statuses = await listAgentStatuses()
      } catch {
        // Transient failure listing sessions - leave every tracked session
        // as-is. Treating "couldn't ask" the same as "none of them exist"
        // would mark every currently-running session crashed on one hiccup.
        return
      }
      const byId = new Map(statuses.map((entry) => [entry.id, entry]))

      for (const tracked of sessions.values()) {
        if (!tracked.alive) continue
        const entry = byId.get(tracked.id)

        // Once a session's underlying process is gone - it finished,
        // crashed, or was stopped - the CLI keeps a stub entry around (for
        // `claude rm`) but drops its `pid`.
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
    } finally {
      pollInFlight = false
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
      const pid = await listAgentStatuses()
        .then((statuses) => statuses.find((entry) => entry.id === id)?.pid)
        .catch(() => undefined)
      if (pid !== undefined) return pid

      if (Date.now() >= deadline) {
        // The session is presumably still running under `--bg` even though
        // we can't find it - don't leave it orphaned just because we're
        // about to report spawning as having failed.
        await execFileAsync(command, ['stop', id]).catch(() => {})
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
      // Not alive already covers "already gone" without needing to ask the
      // CLI to stop something it'll just report as not found.
      if (!tracked || !tracked.alive) return
      await execFileAsync(command, ['stop', tracked.id])
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
      if (!tracked || !tracked.alive) return

      await new Promise<void>((resolve, reject) => {
        const child = pty.spawn(command, ['attach', tracked.id], {
          cols: TERMINAL_COLS,
          rows: TERMINAL_ROWS
        })
        let settled = false
        let wrote = false

        const timeout = setTimeout(() => {
          if (settled) return
          settled = true
          child.kill()
          reject(new Error(`attach for session "${tracked.id}" did not accept input in time`))
        }, RESPOND_TIMEOUT_MS)

        child.onData(() => {
          if (wrote) return
          wrote = true
          // Give the TUI a moment to finish rendering after "Attaching…"
          // before it can reliably accept a keypress.
          setTimeout(() => {
            child.write(`${response}\r`)
            setTimeout(() => {
              if (settled) return
              settled = true
              clearTimeout(timeout)
              child.kill()
              resolve()
            }, 300)
          }, 200)
        })

        child.onExit(({ exitCode }) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          reject(new Error(`attach for session "${tracked.id}" exited before accepting input (code ${exitCode})`))
        })
      })

      tracked.pendingPrompt = null
    }
  }
}
