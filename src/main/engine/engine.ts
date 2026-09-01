import type { PingResult } from '../../shared/ipc-contract'
import type { EngineAdapters, ProcessInfo } from './adapters'

export interface Engine {
  ping(): Promise<PingResult>
  spawnProcess(cwd: string): Promise<ProcessInfo>
}

export function createEngine(adapters: EngineAdapters): Engine {
  return {
    async ping() {
      const sessionCount = await adapters.persistence.loadSessionCount()
      return { ok: true, sessionCount }
    },
    async spawnProcess(cwd: string) {
      return adapters.process.spawnClaude(cwd)
    }
  }
}
