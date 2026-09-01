import type { Project } from '../../shared/ipc-contract'

export interface PersistenceAdapter {
  loadSessionCount(): Promise<number>
  loadProjects(): Promise<Project[]>
  saveProjects(projects: Project[]): Promise<void>
}

export interface WorktreeInfo {
  worktreePath: string
  branch: string
}

export interface GitAdapter {
  createWorktree(projectPath: string): Promise<WorktreeInfo>
}

export interface EngineAdapters {
  persistence: PersistenceAdapter
  git: GitAdapter
}
