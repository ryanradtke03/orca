import type { PendingPrompt, ProcessAdapter, ProcessInfo } from './adapters'

export interface FakeProcessAdapter extends ProcessAdapter {
  simulateExit(pid: number, code: number | null): void
  simulatePrompt(pid: number, prompt: PendingPrompt): void
  spawnedCwds: string[]
  stoppedPids: number[]
  responses: { pid: number; text: string }[]
}

export function createFakeProcessAdapter(seed: { pid?: number } = {}): FakeProcessAdapter {
  let counter = 0
  const processes = new Map<
    number,
    { alive: boolean; exitCode: number | null; pendingPrompt: PendingPrompt | null }
  >()
  const spawnedCwds: string[] = []
  const stoppedPids: number[] = []
  const responses: { pid: number; text: string }[] = []

  return {
    spawnedCwds,
    stoppedPids,
    responses,

    async spawnClaude(cwd: string): Promise<ProcessInfo> {
      counter += 1
      const pid = seed.pid ?? 1000 + counter
      processes.set(pid, { alive: true, exitCode: null, pendingPrompt: null })
      spawnedCwds.push(cwd)
      return { pid }
    },

    async stop(pid: number): Promise<void> {
      stoppedPids.push(pid)
      processes.set(pid, { alive: false, exitCode: null, pendingPrompt: null })
    },

    isAlive(pid: number): boolean {
      return processes.get(pid)?.alive ?? false
    },

    exitCode(pid: number): number | null {
      return processes.get(pid)?.exitCode ?? null
    },

    simulateExit(pid: number, code: number | null): void {
      processes.set(pid, { alive: false, exitCode: code, pendingPrompt: null })
    },

    pendingPrompt(pid: number): PendingPrompt | null {
      return processes.get(pid)?.pendingPrompt ?? null
    },

    simulatePrompt(pid: number, prompt: PendingPrompt): void {
      const process = processes.get(pid)
      if (!process) return
      process.pendingPrompt = prompt
    },

    async registerAlive(pid: number): Promise<void> {
      processes.set(pid, { alive: true, exitCode: null, pendingPrompt: null })
    },

    async respond(pid: number, text: string): Promise<void> {
      responses.push({ pid, text })
      const process = processes.get(pid)
      if (process) process.pendingPrompt = null
    }
  }
}
