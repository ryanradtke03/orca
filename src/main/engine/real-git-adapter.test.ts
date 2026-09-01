import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRealGitAdapter } from './real-git-adapter'

const execFileAsync = promisify(execFile)

async function createTempGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orca-project-'))
  await execFileAsync('git', ['init'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), 'hello')
  await execFileAsync('git', ['add', '.'], { cwd: dir })
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir })
  return dir
}

describe('createRealGitAdapter', () => {
  let projectPath: string
  let worktreesRootDir: string

  beforeEach(async () => {
    projectPath = await createTempGitRepo()
    worktreesRootDir = await mkdtemp(join(tmpdir(), 'orca-worktrees-'))
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
    await rm(worktreesRootDir, { recursive: true, force: true })
  })

  it('creates a new worktree on a new branch', async () => {
    const adapter = createRealGitAdapter(worktreesRootDir)

    const { worktreePath, branch } = await adapter.createWorktree(projectPath)

    expect(existsSync(worktreePath)).toBe(true)
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: worktreePath
    })
    expect(stdout.trim()).toBe(branch)
  })

  it('creates multiple worktrees for the same project without colliding', async () => {
    const adapter = createRealGitAdapter(worktreesRootDir)

    const first = await adapter.createWorktree(projectPath)
    const second = await adapter.createWorktree(projectPath)

    expect(first.worktreePath).not.toBe(second.worktreePath)
    expect(first.branch).not.toBe(second.branch)
    expect(existsSync(first.worktreePath)).toBe(true)
    expect(existsSync(second.worktreePath)).toBe(true)
  })
})
