import { randomUUID } from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { PendingPrompt, ProcessAdapter, ProcessInfo } from './adapters'
import { detectPendingPrompt } from './prompt-detection'

// Caps how much raw output we retain per session. Prompt detection only ever
// looks at the tail, so this just bounds memory for long-running sessions.
const OUTPUT_BUFFER_LIMIT = 16_000

const OUTPUT_POLL_INTERVAL_MS = 300

interface TrackedProcess {
  alive: boolean
  exitCode: number | null
  child: ChildProcess
  pendingPrompt: PendingPrompt | null
  logPath: string
  lastLogSize: number
  pollTimer: ReturnType<typeof setInterval>
}

export function createRealProcessAdapter(
  command = 'claude',
  args: string[] = [],
  logsDir: string = join(tmpdir(), 'orca-session-logs')
): ProcessAdapter {
  const processes = new Map<number, TrackedProcess>()
  mkdirSync(logsDir, { recursive: true })

  function pollOutput(tracked: TrackedProcess): void {
    let size: number
    try {
      size = statSync(tracked.logPath).size
    } catch {
      return
    }
    if (size === tracked.lastLogSize) return
    tracked.lastLogSize = size

    const content = readFileSync(tracked.logPath, 'utf-8').slice(-OUTPUT_BUFFER_LIMIT)
    tracked.pendingPrompt = detectPendingPrompt(content)
  }

  return {
    async spawnClaude(cwd: string): Promise<ProcessInfo> {
      return new Promise((resolve, reject) => {
        const logPath = join(logsDir, `${randomUUID()}.log`)
        // The CLI's stdout/stderr are redirected to a file rather than piped to
        // this process. Sessions are spawned detached so they keep running after
        // Orca quits (ADR 0002); a piped stdout would EPIPE the child the moment
        // Orca closes its end of that pipe on exit. stdin stays piped since only
        // a live Orca can forward a response anyway.
        const logFd = openSync(logPath, 'a')

        const child = spawn(command, args, {
          cwd,
          detached: true,
          stdio: ['pipe', logFd, logFd]
        })
        closeSync(logFd)

        child.once('error', (error) => {
          reject(error)
        })

        child.once('spawn', () => {
          const pid = child.pid
          if (pid === undefined) {
            reject(new Error(`Failed to spawn "${command}": no pid was assigned`))
            return
          }

          const tracked: TrackedProcess = {
            alive: true,
            exitCode: null,
            child,
            pendingPrompt: null,
            logPath,
            lastLogSize: 0,
            pollTimer: setInterval(() => pollOutput(tracked), OUTPUT_POLL_INTERVAL_MS)
          }
          processes.set(pid, tracked)

          child.on('exit', (code) => {
            tracked.alive = false
            tracked.exitCode = code ?? null
            tracked.pendingPrompt = null
            clearInterval(tracked.pollTimer)
            try {
              unlinkSync(tracked.logPath)
            } catch {
              // Already gone, or never got written.
            }
          })

          child.unref()

          resolve({ pid })
        })
      })
    },

    async stop(pid: number): Promise<void> {
      try {
        // Sessions are spawned detached (their own process group leader), so
        // signal the whole group to also reach any subprocesses `claude` started.
        process.kill(-pid, 'SIGTERM')
      } catch {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // Already exited.
        }
      }
    },

    isAlive(pid: number): boolean {
      return processes.get(pid)?.alive ?? false
    },

    exitCode(pid: number): number | null {
      return processes.get(pid)?.exitCode ?? null
    },

    pendingPrompt(pid: number): PendingPrompt | null {
      return processes.get(pid)?.pendingPrompt ?? null
    },

    async respond(pid: number, response: string): Promise<void> {
      const tracked = processes.get(pid)
      if (!tracked || !tracked.alive) return

      await new Promise<void>((resolve, reject) => {
        tracked.child.stdin?.write(`${response}\n`, (error) => {
          if (error) {
            reject(error)
            return
          }
          tracked.pendingPrompt = null
          resolve()
        })
      })
    }
  }
}
