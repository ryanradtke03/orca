import type { Project } from '../../../../shared/ipc-contract'
import type { PersistenceAdapter } from '../../adapters'

export function createFakePersistenceAdapter(
  seed: { sessionCount?: number; projects?: Project[] } = {}
): PersistenceAdapter {
  const sessionCount = seed.sessionCount ?? 0
  let projects = seed.projects ?? []

  return {
    async loadSessionCount() {
      return sessionCount
    },
    async loadProjects() {
      return projects
    },
    async saveProjects(next) {
      projects = next
    }
  }
}
