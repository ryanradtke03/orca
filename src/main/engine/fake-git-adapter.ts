import type { GitAdapter } from './adapters'

export interface FakeGitAdapter extends GitAdapter {
  simulateDirtyWorktree(worktreePath: string): void
  // Makes removeWorktree for this path hang until the returned function is
  // called - lets a test force a cleanup to still be in flight while it
  // exercises a concurrent engine call.
  blockRemoval(worktreePath: string): () => void
  removedWorktrees: { projectPath: string; worktreePath: string }[]
}

export function createFakeGitAdapter(seed: { branch?: string } = {}): FakeGitAdapter {
  let counter = 0
  const dirtyWorktrees = new Set<string>()
  const removalGates = new Map<string, Promise<void>>()
  const removedWorktrees: { projectPath: string; worktreePath: string }[] = []

  return {
    removedWorktrees,

    async createWorktree(projectPath: string) {
      counter += 1
      return {
        worktreePath: `${projectPath}/worktree-${counter}`,
        branch: seed.branch ?? `orca-session-fake-${counter}`
      }
    },

    async removeWorktree(projectPath: string, worktreePath: string) {
      if (dirtyWorktrees.has(worktreePath)) {
        throw new Error(`'${worktreePath}' contains modified or untracked files`)
      }
      const gate = removalGates.get(worktreePath)
      if (gate) await gate
      removedWorktrees.push({ projectPath, worktreePath })
    },

    simulateDirtyWorktree(worktreePath: string): void {
      dirtyWorktrees.add(worktreePath)
    },

    blockRemoval(worktreePath: string): () => void {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      removalGates.set(worktreePath, gate)
      return release
    }
  }
}
