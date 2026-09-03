import { readFile, writeFile } from 'fs/promises'
import type { Project } from '../../../../shared/ipc-contract'
import type { PersistenceAdapter } from '../../adapters'

// mergeMode is optional here (unlike on Project) because a project persisted
// before Merge mode existed has no such field on disk.
type PersistedProject = Omit<Project, 'mergeMode'> & { mergeMode?: Project['mergeMode'] }

interface PersistedState {
  sessionCount?: number
  projects?: PersistedProject[]
}

async function readState(stateFilePath: string): Promise<PersistedState> {
  let raw: string
  try {
    raw = await readFile(stateFilePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }

  try {
    return JSON.parse(raw) as PersistedState
  } catch {
    return {}
  }
}

export function createRealPersistenceAdapter(stateFilePath: string): PersistenceAdapter {
  return {
    async loadSessionCount() {
      const state = await readState(stateFilePath)
      return typeof state.sessionCount === 'number' ? state.sessionCount : 0
    },
    async loadProjects() {
      const state = await readState(stateFilePath)
      if (!Array.isArray(state.projects)) return []
      // Projects persisted before Merge mode existed have no mergeMode field.
      return state.projects.map((project) => ({ mergeMode: 'manual', ...project }))
    },
    async saveProjects(projects) {
      const state = await readState(stateFilePath)
      const updated: PersistedState = { ...state, projects }
      await writeFile(stateFilePath, JSON.stringify(updated, null, 2))
    }
  }
}
