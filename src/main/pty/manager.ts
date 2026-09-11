import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { Session } from '@shared/domain'
import type {
  SpawnSessionRequest,
  SessionDataEvent,
  SessionExitEvent
} from '@shared/ipc'

const DEFAULT_SHELL = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash'

interface PtyManagerEvents {
  data: (e: SessionDataEvent) => void
  exit: (e: SessionExitEvent) => void
}

/**
 * Owns the live PTY processes — the source of truth for sessions.
 * The renderer never holds a process, only a mirror keyed by the same id.
 */
export class PtyManager extends EventEmitter {
  private processes = new Map<string, IPty>()
  private sessions = new Map<string, Session>()

  spawn(req: SpawnSessionRequest): Session {
    const id = randomUUID()
    const shell = req.shell ?? DEFAULT_SHELL

    const proc = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: req.cols,
      rows: req.rows,
      cwd: req.cwd,
      env: process.env as Record<string, string>
    })

    const session: Session = {
      id,
      projectId: req.projectId,
      title: shell,
      status: 'running',
      cwd: req.cwd,
      shell,
      createdAt: Date.now()
    }

    proc.onData((data) => this.emit('data', { sessionId: id, data } satisfies SessionDataEvent))
    proc.onExit(({ exitCode, signal }) => {
      this.processes.delete(id)
      this.emit('exit', { sessionId: id, exitCode, signal } satisfies SessionExitEvent)
    })

    this.processes.set(id, proc)
    this.sessions.set(id, session)
    return session
  }

  write(sessionId: string, data: string): void {
    this.processes.get(sessionId)?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.processes.get(sessionId)?.resize(cols, rows)
  }

  kill(sessionId: string): void {
    this.processes.get(sessionId)?.kill()
    this.processes.delete(sessionId)
    this.sessions.delete(sessionId)
  }

  list(): Session[] {
    return [...this.sessions.values()]
  }

  killAll(): void {
    for (const id of this.processes.keys()) this.kill(id)
  }

  // Typed event overloads
  override on<E extends keyof PtyManagerEvents>(event: E, listener: PtyManagerEvents[E]): this {
    return super.on(event, listener)
  }
  override emit<E extends keyof PtyManagerEvents>(
    event: E,
    ...args: Parameters<PtyManagerEvents[E]>
  ): boolean {
    return super.emit(event, ...args)
  }
}
