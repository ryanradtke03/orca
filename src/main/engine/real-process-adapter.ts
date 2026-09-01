import { spawn } from 'child_process'
import type { ProcessAdapter, ProcessInfo } from './adapters'

interface TrackedProcess {
  alive: boolean
  exitCode: number | null
}

export function createRealProcessAdapter(
  command = 'claude',
  args: string[] = []
): ProcessAdapter {
  const processes = new Map<number, TrackedProcess>()

  return {
    async spawnClaude(cwd: string): Promise<ProcessInfo> {
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          cwd,
          detached: true,
          stdio: 'ignore'
        })

        child.once('error', (error) => {
          reject(error)
        })

        child.once('spawn', () => {
          const pid = child.pid
          if (pid === undefined) {
            reject(new Error(`Failed to spawn "${command}": no pid was assigned`))
            return
          }

          processes.set(pid, { alive: true, exitCode: null })

          child.on('exit', (code) => {
            processes.set(pid, { alive: false, exitCode: code ?? null })
          })

          child.unref()

          resolve({ pid })
        })
      })
    },

    isAlive(pid: number): boolean {
      return processes.get(pid)?.alive ?? false
    },

    exitCode(pid: number): number | null {
      return processes.get(pid)?.exitCode ?? null
    }
  }
}
