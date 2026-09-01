import type { PingResult } from '../../shared/ipc-contract'
import type { EngineAdapters } from './adapters'

export interface Engine {
  ping(): Promise<PingResult>
}

export function createEngine(adapters: EngineAdapters): Engine {
  return {
    async ping() {
      const sessionCount = await adapters.persistence.loadSessionCount()
      return { ok: true, sessionCount }
    }
  }
}
