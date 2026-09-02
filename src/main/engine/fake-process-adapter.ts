import type { ProcessAdapter, ProcessInfo } from './adapters'

export interface FakeProcessAdapter extends ProcessAdapter {
  simulateExit(pid: number, code: number | null): void
  spawnedCwds: string[]
  stoppedPids: number[]
}

export function createFakeProcessAdapter(seed: { pid?: number } = {}): FakeProcessAdapter {
  let counter = 0
  const processes = new Map<number, { alive: boolean; exitCode: number | null }>()
  const spawnedCwds: string[] = []
  const stoppedPids: number[] = []

  return {
    spawnedCwds,
    stoppedPids,

    async spawnClaude(cwd: string): Promise<ProcessInfo> {
      counter += 1
      const pid = seed.pid ?? 1000 + counter
      processes.set(pid, { alive: true, exitCode: null })
      spawnedCwds.push(cwd)
      return { pid }
    },

    async stop(pid: number): Promise<void> {
      stoppedPids.push(pid)
      processes.set(pid, { alive: false, exitCode: null })
    },

    isAlive(pid: number): boolean {
      return processes.get(pid)?.alive ?? false
    },

    exitCode(pid: number): number | null {
      return processes.get(pid)?.exitCode ?? null
    },

    simulateExit(pid: number, code: number): void {
      processes.set(pid, { alive: false, exitCode: code })
    }
  }
}
