import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { promisify } from 'util'
import type { GitAdapter } from './adapters'

const execFileAsync = promisify(execFile)

export function createRealGitAdapter(worktreesRootDir: string): GitAdapter {
  return {
    async createWorktree(projectPath: string) {
      const id = randomUUID()
      const branch = `orca-session-${id}`
      const worktreePath = join(worktreesRootDir, id)

      await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath], {
        cwd: projectPath
      })

      return { worktreePath, branch }
    }
  }
}
