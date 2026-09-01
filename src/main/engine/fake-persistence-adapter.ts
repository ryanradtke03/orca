import type { PersistenceAdapter } from './adapters'

export function createFakePersistenceAdapter(
  seed: { sessionCount?: number } = {}
): PersistenceAdapter {
  const sessionCount = seed.sessionCount ?? 0

  return {
    async loadSessionCount() {
      return sessionCount
    }
  }
}
