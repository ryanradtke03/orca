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
        cliSessionId: 'session-1',
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

  it('resolves a waiting-on-permission session, classifying its prompt from `claude logs`', async () => {
    await writeTranscript('session-1', projectPath)
    // state: 'blocked' is the CLI's "waiting on the user" signal; the kind is
    // classified from the rendered dialog (no waitingFor on the current CLI).
    writeFakeCliState([
      {
        id: 'session-1',
        pid: 4242,
        status: 'idle',
        processState: 'blocked',
        screen: 'Bash command\r\n\r\n  npm install\r\n\r\nDo you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n'
      }
    ])
    const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
      { id: 'session-1', pid: 4242, status: 'idle', state: 'blocked' }
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
        status: 'idle',
        processState: 'blocked',
        screen: 'Which auth approach should I use?\r\n❯ 1. OAuth\r\n  2. API key\r\n'
      }
    ])
    const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
      { id: 'session-1', pid: 4242, status: 'idle', state: 'blocked' }
    ]
    const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

    const [discovered] = await adapter.scan()

    expect(discovered.status).toBe('waiting-on-input')
    expect(discovered.pendingPrompt).toEqual({
      type: 'input',
      text: expect.stringContaining('Which auth approach')
    })
  })

  it('locates a session transcript filed under the full UUID from its short CLI id', async () => {
    // The CLI files the transcript under the full session UUID but reports a
    // short `id` (the UUID's first segment); scan must still find the cwd.
    await writeTranscript('a49b4cbc-48c4-4943-9d2c-b67619c50be6', projectPath)
    const listAgentStatuses = async (): Promise<AgentStatusEntry[]> => [
      { id: 'a49b4cbc', sessionId: 'a49b4cbc-48c4-4943-9d2c-b67619c50be6', pid: 4242, status: 'busy' }
    ]
    const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir, listAgentStatuses)

    const [discovered] = await adapter.scan()

    expect(discovered).toMatchObject({
      cwd: projectPath,
      cliSessionId: 'a49b4cbc-48c4-4943-9d2c-b67619c50be6',
      status: 'running'
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
        cliSessionId: 'session-1',
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

  describe('readTranscript', () => {
    async function writeTranscriptLines(sessionId: string, lines: unknown[]): Promise<void> {
      const sessionDir = join(transcriptsRootDir, 'nested', 'dir')
      await mkdir(sessionDir, { recursive: true })
      await writeFile(
        join(sessionDir, `${sessionId}.jsonl`),
        lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
      )
    }

    it('locates the transcript by CLI session id and parses its conversation turns', async () => {
      await writeTranscriptLines('session-1', [
        { type: 'mode', mode: 'default' },
        {
          type: 'user',
          uuid: 'u1',
          timestamp: '2026-09-03T23:41:17.707Z',
          message: { role: 'user', content: 'add a readme' }
        },
        {
          type: 'assistant',
          uuid: 'a1',
          timestamp: '2026-09-03T23:41:22.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }
        }
      ])
      const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir)

      const transcript = await adapter.readTranscript('session-1')
      expect(transcript.map((message) => ({ role: message.role, text: message.text }))).toEqual([
        { role: 'user', text: 'add a readme' },
        { role: 'assistant', text: 'Done.' }
      ])
    })

    it('resolves the full-UUID transcript file from a short CLI id prefix', async () => {
      await writeTranscriptLines('a49b4cbc-48c4-4943-9d2c-b67619c50be6', [
        { type: 'user', uuid: 'u1', message: { role: 'user', content: 'hi' } },
        { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } }
      ])
      const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir)

      const transcript = await adapter.readTranscript('a49b4cbc')
      expect(transcript.map((message) => message.text)).toEqual(['hi', 'hello'])
    })

    it('does not guess when a short id prefix matches more than one transcript', async () => {
      await writeTranscriptLines('a49b4cbc-1111-4943-9d2c-b67619c50be6', [
        { type: 'user', uuid: 'u1', message: { role: 'user', content: 'one' } }
      ])
      await writeTranscriptLines('a49b4cbc-2222-4943-9d2c-b67619c50be6', [
        { type: 'user', uuid: 'u2', message: { role: 'user', content: 'two' } }
      ])
      const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir)

      await expect(adapter.readTranscript('a49b4cbc')).resolves.toEqual([])
    })

    it('returns an empty history when no transcript file exists for the id', async () => {
      const adapter = createRealDiscoveryAdapter(FAKE_CLI, transcriptsRootDir)
      await expect(adapter.readTranscript('nonexistent')).resolves.toEqual([])
    })
  })
})
