export interface PersistenceAdapter {
  loadSessionCount(): Promise<number>
}

export interface ProcessInfo {
  pid: number
}

export interface ProcessAdapter {
  spawnClaude(cwd: string): Promise<ProcessInfo>
  isAlive(pid: number): boolean
  exitCode(pid: number): number | null
}

export interface EngineAdapters {
  persistence: PersistenceAdapter
  process: ProcessAdapter
}
