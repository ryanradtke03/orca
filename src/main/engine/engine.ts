import type { PingResult } from '../../shared/ipc-contract'
import type { EngineAdapters, WorktreeInfo } from './adapters'

export interface Engine {
  ping(): Promise<PingResult>
  createWorktree(projectPath: string): Promise<WorktreeInfo>
}

export function createEngine(adapters: EngineAdapters): Engine {
  return {
    async ping() {
      const sessionCount = await adapters.persistence.loadSessionCount()
      return { ok: true, sessionCount }
    },
    async createWorktree(projectPath: string) {
      return adapters.git.createWorktree(projectPath)
    }
  }
}
