export interface PersistenceAdapter {
  loadSessionCount(): Promise<number>
}

export interface EngineAdapters {
  persistence: PersistenceAdapter
}
