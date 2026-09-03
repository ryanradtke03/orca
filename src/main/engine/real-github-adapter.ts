import { execFile } from 'child_process'
import { promisify } from 'util'
import type { GitHubAdapter } from './adapters'

const execFileAsync = promisify(execFile)

export function createRealGitHubAdapter(): GitHubAdapter {
  return {
    async openPullRequest({ projectPath, branch, title }) {
      // `gh pr create` prints the created PR's URL as the last line of
      // stdout (it also prints "Creating pull request..." progress text
      // above it) - no `--json` flag is needed just to read the URL back.
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'create', '--head', branch, '--title', title, '--body', ''],
        { cwd: projectPath }
      )

      const lines = stdout.trim().split('\n').filter(Boolean)
      const url = lines[lines.length - 1] ?? ''
      return { url }
    }
  }
}
