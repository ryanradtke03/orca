import { execFile } from 'child_process'
import { writeFileSync } from 'fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../claude-cli/agent-status'
import { createRealDiscoveryAdapter } from './real'

const execFileAsync = promisify(execFile)

const FAKE_CLI = join(__dirname, '../../claude-cli/fake-cli.cjs')

async function createTempGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orca-discovery-project-'))
  await execFileAsync('git', ['init'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), 'hello')
  await execFileAsync('git', ['add', '.'], { cwd: dir })
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir })
  return dir
}

describe('createRealDiscoveryAdapter', () => {
  let transcriptsRootDir: string
  let projectPath: string
  let statePath: string

  async function writeTranscript(sessionId: string, cwd: string): Promise<void> {
    const sessionDir = join(transcriptsRootDir, 'nested', 'dir')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, `${sessionId}.jsonl`), `${JSON.stringify({ cwd })}\n`)
  }

  function writeFakeCliState(entries: unknown[]): void {
    writeFileSync(statePath, JSON.stringify({ entries }))
  }

  beforeEach(async () => {
    transcriptsRootDir = await mkdtemp(join(tmpdir(), 'orca-transcripts-'))
    projectPath = await createTempGitRepo()
    const stateDir = await mkdtemp(join(tmpdir(), 'orca-fake-cli-state-'))
    statePath = join(stateDir, 'state.json')
    process.env.ORCA_FAKE_CLI_STATE = statePath
  })

  afterEach(async () => {
    delete process.env.ORCA_FAKE_CLI_STATE
    await rm(transcriptsRootDir, { recursive: true, force: true })
    await rm(projectPath, { recursive: true, force: true })
  })

  it('discovers a running session, resolving its cwd from a transcript and project path via git', async () => {
    await writeTranscript('session-1', projectPath)
    const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
      { id: 'session-1', pid: 4242, status: 'busy' }
    ]
    const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

    const discovered = await adapter.scan()

    expect(discovered).toEqual([
      {
        pid: 4242,
        cwd: projectPath,
        // `git rev-parse --show-toplevel` resolves symlinks (e.g. macOS's
        // /tmp -> /private/tmp), so the resolved projectPath can differ from
        // the raw cwd the transcript reported.
        projectPath: await realpath(projectPath),
        branch: expect.any(String),
        baseRef: expect.any(String),
        status: 'running',
        pendingPrompt: undefined
      }
    ])
  })

  it('reports idle sessions as idle', async () => {
    await writeTranscript('session-1', projectPath)
    const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
      { id: 'session-1', pid: 4242, status: 'idle' }
    ]
    const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

    const [discovered] = await adapter.scan()

    expect(discovered.status).toBe('idle')
  })

  it('resolves a waiting-on-permission session, including its prompt text from `claude logs`', async () => {
    await writeTranscript('session-1', projectPath)
    writeFakeCliState([
      {
        id: 'session-1',
        pid: 4242,
        status: 'waiting',
        waitingFor: 'permission prompt',
        processState: 'blocked',
        screen: 'Bash command\r\n\r\n  npm install\r\n\r\nDo you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n'
      }
    ])
    const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
      { id: 'session-1', pid: 4242, status: 'waiting', waitingFor: 'permission prompt' }
    ]
    const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

    const [discovered] = await adapter.scan()

    expect(discovered.status).toBe('waiting-on-permission')
    expect(discovered.pendingPrompt).toEqual({
      type: 'permission',
      text: expect.stringContaining('Do you want to proceed?')
    })
  })

  it('resolves a waiting-on-input session from a clarifying question', async () => {
    await writeTranscript('session-1', projectPath)
    writeFakeCliState([
      {
        id: 'session-1',
        pid: 4242,
        status: 'waiting',
        waitingFor: 'input needed',
        processState: 'blocked',
        screen: 'Which auth approach should I use?\r\n❯ 1. OAuth\r\n  2. API key\r\n'
      }
    ])
    const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
      { id: 'session-1', pid: 4242, status: 'waiting', waitingFor: 'input needed' }
    ]
    const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

    const [discovered] = await adapter.scan()

    expect(discovered.status).toBe('waiting-on-input')
    expect(discovered.pendingPrompt).toEqual({
      type: 'input',
      text: expect.stringContaining('Which auth approach')
    })
  })

  it('skips sessions with no pid - the CLI no longer considers them running', async () => {
    await writeTranscript('session-1', projectPath)
    const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
      { id: 'session-1', state: 'done' }
    ]
    const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

    await expect(adapter.scan()).resolves.toEqual([])
  })

  it('skips a session whose transcript cannot be found, since its cwd is unknown', async () => {
    const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
      { id: 'session-missing-transcript', pid: 4242, status: 'busy' }
    ]
    const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

    await expect(adapter.scan()).resolves.toEqual([])
  })

  it('skips a session whose cwd is not inside a git repository', async () => {
    const bareDir = await mkdtemp(join(tmpdir(), 'orca-non-git-'))
    try {
      await writeTranscript('session-1', bareDir)
      const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
        { id: 'session-1', pid: 4242, status: 'busy' }
      ]
      const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

      await expect(adapter.scan()).resolves.toEqual([])
    } finally {
      await rm(bareDir, { recursive: true, force: true })
    }
  })

  it('discovers multiple sessions independently', async () => {
    const secondProjectPath = await createTempGitRepo()
    try {
      await writeTranscript('session-1', projectPath)
      await writeTranscript('session-2', secondProjectPath)
      const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
        { id: 'session-1', pid: 1111, status: 'busy' },
        { id: 'session-2', pid: 2222, status: 'idle' }
      ]
      const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

      const discovered = await adapter.scan()

      expect(discovered).toHaveLength(2)
      expect(discovered.find((s) => s.pid === 1111)).toMatchObject({ cwd: projectPath, status: 'running' })
      expect(discovered.find((s) => s.pid === 2222)).toMatchObject({ cwd: secondProjectPath, status: 'idle' })
    } finally {
      await rm(secondProjectPath, { recursive: true, force: true })
    }
  })

  it('returns an empty list rather than throwing when listing agent statuses fails', async () => {
    const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => {
      throw new Error('simulated transient failure')
    }
    const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

    await expect(adapter.scan()).resolves.toEqual([])
  })

  describe('resolveManual', () => {
    it('resolves a session by pid using the caller-supplied directory, no transcript required', async () => {
      const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
        { id: 'session-1', pid: 4242, status: 'busy' }
      ]
      const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

      const resolved = await adapter.resolveManual(4242, projectPath)

      expect(resolved).toEqual({
        pid: 4242,
        cwd: projectPath,
        projectPath: await realpath(projectPath),
        branch: expect.any(String),
        baseRef: expect.any(String),
        status: 'running',
        pendingPrompt: undefined
      })
    })

    it('returns null when no running session has that pid', async () => {
      const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
        { id: 'session-1', pid: 4242, status: 'busy' }
      ]
      const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

      await expect(adapter.resolveManual(9999, projectPath)).resolves.toBeNull()
    })

    it('returns null when the given directory is not inside a git repository', async () => {
      const bareDir = await mkdtemp(join(tmpdir(), 'orca-non-git-'))
      try {
        const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
          { id: 'session-1', pid: 4242, status: 'busy' }
        ]
        const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

        await expect(adapter.resolveManual(4242, bareDir)).resolves.toBeNull()
      } finally {
        await rm(bareDir, { recursive: true, force: true })
      }
    })

    it('returns null rather than throwing when listing agent statuses fails', async () => {
      const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => {
        throw new Error('simulated transient failure')
      }
      const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

      await expect(adapter.resolveManual(4242, projectPath)).resolves.toBeNull()
    })
  })
})
