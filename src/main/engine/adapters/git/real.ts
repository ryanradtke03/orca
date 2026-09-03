import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { promisify } from 'util'
import type { GitAdapter } from '../../adapters'
import { parseUnifiedDiff } from './diff-parser'

const execFileAsync = promisify(execFile)

// A Session's diff can span many changed files; the default 1MB stdout
// buffer is easy to blow past on a real refactor-sized change.
const DIFF_MAX_BUFFER_BYTES = 20 * 1024 * 1024

// Caps how many `git diff --no-index` child processes run at once when a
// worktree has many untracked files, so a session that dumps a large,
// gitignore-missed directory can't exhaust process/file-descriptor limits.
const UNTRACKED_DIFF_CONCURRENCY = 8

async function listUntrackedFiles(worktreePath: string): Promise<string[]> {
  // `-z` NUL-separates entries with no quoting - plain (newline-separated)
  // `ls-files` output C-quotes "unusual" paths (non-ASCII, spaces, etc.),
  // and passing that quoted literal straight to `git diff --no-index` as a
  // pathspec fails since no file has that literal quoted name.
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '-z', '--others', '--exclude-standard'],
    { cwd: worktreePath, maxBuffer: DIFF_MAX_BUFFER_BYTES }
  )
  return stdout.split('\0').filter(Boolean)
}

async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await fn(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// Plain `git diff <base>` never shows untracked files - they're invisible to
// it by design. `--no-index` against /dev/null renders one as a clean "new
// file" diff without staging it (which would mutate the index a Session
// might still be using).
async function diffUntrackedFile(worktreePath: string, relativePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-color', '--no-index', '--', '/dev/null', relativePath],
      { cwd: worktreePath, maxBuffer: DIFF_MAX_BUFFER_BYTES }
    )
    return stdout
  } catch (error) {
    // `--no-index` exits 1 (not 0) when it finds differences - that's the
    // expected/common outcome here, not a failure, but exit 1 also covers
    // real errors (e.g. an unreadable file) that happen to produce no
    // stdout - only treat it as success when there's actual diff output.
    const execError = error as { code?: number; stdout?: string }
    if (execError.code === 1 && execError.stdout) return execError.stdout
    throw error
  }
}

// A Session's own process can still be editing the worktree while the user
// is looking at its diff, so a file `ls-files` just reported as untracked
// can vanish (or become unreadable) by the time it's actually diffed. That
// one file's diff is worth losing; the tracked diff and every other
// untracked file's diff the batch already produced are not.
async function diffUntrackedFileTolerantly(worktreePath: string, relativePath: string): Promise<string> {
  try {
    return await diffUntrackedFile(worktreePath, relativePath)
  } catch (error) {
    console.error(`Failed to diff untracked file "${relativePath}" in ${worktreePath}:`, error)
    return ''
  }
}

// A Session's worktree can still hold uncommitted (even untracked) changes
// when the user asks to merge - getDiff shows those alongside its committed
// ones, so leaving them behind would silently merge/push less than what the
// user actually reviewed.
async function commitOutstandingChanges(worktreePath: string): Promise<void> {
  const { stdout: statusOutput } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd: worktreePath
  })
  if (!statusOutput.trim()) return

  await execFileAsync('git', ['add', '-A'], { cwd: worktreePath })
  await execFileAsync(
    'git',
    ['commit', '-m', 'Orca: commit outstanding session changes before merge'],
    { cwd: worktreePath }
  )
}

export function createRealGitAdapter(worktreesRootDir: string): GitAdapter {
  return {
    async createWorktree(projectPath: string) {
      const id = randomUUID()
      const branch = `orca-session-${id}`
      const worktreePath = join(worktreesRootDir, id)

      const { stdout: headRef } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: projectPath
      })
      const baseRef = headRef.trim()

      await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath], {
        cwd: projectPath
      })

      return { worktreePath, branch, baseRef }
    },

    async removeWorktree(projectPath: string, worktreePath: string) {
      await execFileAsync('git', ['worktree', 'remove', worktreePath], { cwd: projectPath })
    },

    async discardWorktree(projectPath: string, worktreePath: string) {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: projectPath
      })
    },

    async getDiff(worktreePath: string, baseRef: string) {
      // Compares baseRef's tree against the worktree's current working tree,
      // covering both committed-on-branch and still-uncommitted changes -
      // "everything the Session has changed" regardless of whether it commits.
      // `-M` makes rename detection explicit rather than depending on the
      // user's ambient git config. Untracked files need a second, separate
      // diff (see diffUntrackedFile).
      const [{ stdout: trackedDiff }, untrackedFiles] = await Promise.all([
        execFileAsync('git', ['diff', '--no-color', '-M', baseRef], {
          cwd: worktreePath,
          maxBuffer: DIFF_MAX_BUFFER_BYTES
        }),
        listUntrackedFiles(worktreePath)
      ])
      const untrackedDiffs = await mapWithConcurrencyLimit(
        untrackedFiles,
        UNTRACKED_DIFF_CONCURRENCY,
        (path) => diffUntrackedFileTolerantly(worktreePath, path)
      )

      const blocks = [trackedDiff, ...untrackedDiffs].map((block) => block.trim()).filter(Boolean)
      return parseUnifiedDiff(blocks.join('\n'))
    },

    async mergeWorktree({ projectPath, worktreePath, branch }) {
      await commitOutstandingChanges(worktreePath)

      // Runs against projectPath (the Project's own working directory, on
      // whatever branch it currently has checked out), not the worktree -
      // the worktree only ever holds the Session's own branch.
      try {
        await execFileAsync('git', ['merge', '--no-ff', branch], { cwd: projectPath })
      } catch (error) {
        // A conflicted merge leaves projectPath mid-merge (MERGE_HEAD set,
        // conflicted files) - abort it so the Project's own checkout stays
        // usable instead of silently stuck until the user notices.
        await execFileAsync('git', ['merge', '--abort'], { cwd: projectPath }).catch(() => {})
        throw error
      }
    },

    async pushBranch(worktreePath: string, branch: string) {
      await commitOutstandingChanges(worktreePath)
      await execFileAsync('git', ['push', '-u', 'origin', branch], { cwd: worktreePath })
    }
  }
}
