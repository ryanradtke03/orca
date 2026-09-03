import type { FileDiff, GitAdapter } from './adapters'

export interface FakeGitAdapter extends GitAdapter {
  getDiffCalls: { worktreePath: string; baseRef: string }[]
  removeWorktreeCalls: { projectPath: string; worktreePath: string }[]
  simulateDiff(worktreePath: string, files: FileDiff[]): void
}

export function createFakeGitAdapter(seed: { branch?: string } = {}): FakeGitAdapter {
  let counter = 0
  const diffsByWorktree = new Map<string, FileDiff[]>()
  const getDiffCalls: { worktreePath: string; baseRef: string }[] = []
  const removeWorktreeCalls: { projectPath: string; worktreePath: string }[] = []

  return {
    getDiffCalls,
    removeWorktreeCalls,

    async createWorktree(projectPath: string) {
      counter += 1
      return {
        worktreePath: `${projectPath}/worktree-${counter}`,
        branch: seed.branch ?? `orca-session-fake-${counter}`,
        baseRef: `base-${counter}`
      }
    },

    async removeWorktree(projectPath: string, worktreePath: string) {
      removeWorktreeCalls.push({ projectPath, worktreePath })
    },

    async getDiff(worktreePath: string, baseRef: string) {
      getDiffCalls.push({ worktreePath, baseRef })
      return diffsByWorktree.get(worktreePath) ?? []
    },

    simulateDiff(worktreePath: string, files: FileDiff[]): void {
      diffsByWorktree.set(worktreePath, files)
    }
  }
}
