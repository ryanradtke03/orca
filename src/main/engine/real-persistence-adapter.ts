import { readFile } from 'fs/promises'
import type { PersistenceAdapter } from './adapters'

interface PersistedState {
  sessionCount?: number
}

export function createRealPersistenceAdapter(stateFilePath: string): PersistenceAdapter {
  return {
    async loadSessionCount() {
      let raw: string
      try {
        raw = await readFile(stateFilePath, 'utf-8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
        throw error
      }

      let state: PersistedState
      try {
        state = JSON.parse(raw) as PersistedState
      } catch {
        return 0
      }

      return typeof state.sessionCount === 'number' ? state.sessionCount : 0
    }
  }
}
