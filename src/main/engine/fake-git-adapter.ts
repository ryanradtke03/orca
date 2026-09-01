import type { GitAdapter } from './adapters'

export function createFakeGitAdapter(seed: { branch?: string } = {}): GitAdapter {
  let counter = 0

  return {
    async createWorktree(projectPath: string) {
      counter += 1
      return {
        worktreePath: `${projectPath}/worktree-${counter}`,
        branch: seed.branch ?? `orca-session-fake-${counter}`
      }
    }
  }
}
