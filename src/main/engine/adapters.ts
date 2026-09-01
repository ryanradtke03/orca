import type { Project } from '../../shared/ipc-contract'

export interface PersistenceAdapter {
  loadSessionCount(): Promise<number>
  loadProjects(): Promise<Project[]>
  saveProjects(projects: Project[]): Promise<void>
}

export interface EngineAdapters {
  persistence: PersistenceAdapter
}
