export interface PersistenceAdapter {
  loadSessionCount(): Promise<number>
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
