import { spawn } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { mkdtemp, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentStatusLister } from '../../claude-cli/agent-status'
import { createRealProcessAdapter } from './real'

const FAKE_CLI = join(__dirname, '../../claude-cli/fake-cli.cjs')

interface FakeEntry {
  id: string
  pid: number
  cwd: string
  status: 'idle' | 'busy' | 'waiting'
  waitingFor?: string
  processState: 'blocked' | 'done'
  screen: string
  responses?: string[]
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function isOsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('createRealProcessAdapter', () => {
  let dir: string
  let statePath: string

  function readEntries(): FakeEntry[] {
    return JSON.parse(readFileSync(statePath, 'utf-8')).entries
  }

  function writeEntries(entries: FakeEntry[]): void {
    writeFileSync(statePath, JSON.stringify({ entries }))
  }

  function entryForPid(pid: number): FakeEntry {
    const entry = readEntries().find((candidate) => candidate.pid === pid)
    if (!entry) throw new Error(`no fake-cli entry for pid ${pid}`)
    return entry
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orca-process-'))
    statePath = join(dir, 'fake-cli-state.json')
    writeEntries([])
    process.env.ORCA_FAKE_CLI_STATE = statePath
  })

  afterEach(async () => {
    for (const entry of readEntries()) {
      try {
        process.kill(entry.pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
    delete process.env.ORCA_FAKE_CLI_STATE
    await rm(dir, { recursive: true, force: true })
  })

  it('spawns the session rooted at the given directory', async () => {
    const adapter = createRealProcessAdapter(FAKE_CLI)

    const { pid } = await adapter.spawnClaude(dir)

    expect(entryForPid(pid).cwd).toBe(await realpath(dir))
  })

  it('reports the session alive right after spawning, then not alive once it finishes', async () => {
    const adapter = createRealProcessAdapter(FAKE_CLI)

    const { pid } = await adapter.spawnClaude(dir)
    expect(adapter.isAlive(pid)).toBe(true)
    expect(adapter.exitCode(pid)).toBeNull()

    const entry = entryForPid(pid)
    entry.processState = 'done'
    writeEntries(readEntries().map((candidate) => (candidate.pid === pid ? entry : candidate)))
    process.kill(pid, 'SIGTERM')

    await waitUntil(() => !adapter.isAlive(pid))
    expect(adapter.exitCode(pid)).toBe(0)
  })

  it('reports a session as errored if its process disappears without finishing', async () => {
    const adapter = createRealProcessAdapter(FAKE_CLI)

    const { pid } = await adapter.spawnClaude(dir)
    process.kill(pid, 'SIGKILL')

    await waitUntil(() => !adapter.isAlive(pid))
    expect(adapter.exitCode(pid)).toBe(1)
  })

  it('stops a running session, marking it not alive', async () => {
    const adapter = createRealProcessAdapter(FAKE_CLI)

    const { pid } = await adapter.spawnClaude(dir)
    expect(adapter.isAlive(pid)).toBe(true)

    await adapter.stop(pid)

    await waitUntil(() => !isOsProcessAlive(pid))
  })

  it('resolves without throwing when stopping a pid it never tracked', async () => {
    const adapter = createRealProcessAdapter(FAKE_CLI)

    await expect(adapter.stop(999_999)).resolves.toBeUndefined()
  })

  it('registers a pid it never spawned as alive, once the CLI confirms it is running', async () => {
    const adapter = createRealProcessAdapter(FAKE_CLI)
    // Simulates a session Discovery/Adopt found via `claude agents`, without
    // ever going through this adapter's own spawnClaude - a real (but
    // otherwise unmanaged) process, since the fake CLI's own `agents`
    // listing reports a pid as crashed/done unless the OS confirms it alive.
    const external = spawn(process.execPath, [FAKE_CLI, '--worker'], { detached: true, stdio: 'ignore' })
    external.unref()
    const externalPid = external.pid
    if (externalPid === undefined) throw new Error('failed to spawn external worker process')
    writeEntries([
      { id: 'external-session', pid: externalPid, cwd: dir, status: 'busy', processState: 'blocked', screen: '' }
    ])
    expect(adapter.isAlive(externalPid)).toBe(false)

    await adapter.registerAlive(externalPid)

    expect(adapter.isAlive(externalPid)).toBe(true)
    expect(adapter.exitCode(externalPid)).toBeNull()
  })

  it('rejects registering a pid the CLI does not report as running', async () => {
    const adapter = createRealProcessAdapter(FAKE_CLI)

    await expect(adapter.registerAlive(999_999)).rejects.toThrow()
    expect(adapter.isAlive(999_999)).toBe(false)
  })

  it('reports no pending prompt while the session is idle', async () => {
    const adapter = createRealProcessAdapter(FAKE_CLI)

    const { pid } = await adapter.spawnClaude(dir)

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(adapter.pendingPrompt(pid)).toBeNull()
  })

  it('detects a permission prompt once the session reports waiting on one', async () => {
    const adapter = createRealProcessAdapter(FAKE_CLI)
    const { pid } = await adapter.spawnClaude(dir)

    const entry = entryForPid(pid)
    entry.status = 'waiting'
    entry.waitingFor = 'permission prompt'
    entry.screen = 'Bash command\r\n\r\n  npm install\r\n\r\nDo you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n'
    writeEntries(readEntries().map((candidate) => (candidate.pid === pid ? entry : candidate)))

    await waitUntil(() => adapter.pendingPrompt(pid) !== null)
    expect(adapter.pendingPrompt(pid)).toEqual({
      type: 'permission',
      text: expect.stringContaining('Do you want to proceed?')
    })
  })

  it('detects an input prompt once the session reports waiting on one', async () => {
    const adapter = createRealProcessAdapter(FAKE_CLI)
    const { pid } = await adapter.spawnClaude(dir)

    const entry = entryForPid(pid)
    entry.status = 'waiting'
    entry.waitingFor = 'input needed'
    entry.screen = 'Which auth approach should I use?\r\n❯ 1. OAuth\r\n  2. API key\r\n'
    writeEntries(readEntries().map((candidate) => (candidate.pid === pid ? entry : candidate)))

    await waitUntil(() => adapter.pendingPrompt(pid) !== null)
    expect(adapter.pendingPrompt(pid)).toEqual({
      type: 'input',
      text: expect.stringContaining('Which auth approach')
    })
  })

  it('sends a response through a pty attach and clears the pending prompt', async () => {
    const adapter = createRealProcessAdapter(FAKE_CLI)
    const { pid } = await adapter.spawnClaude(dir)

    const entry = entryForPid(pid)
    entry.status = 'waiting'
    entry.waitingFor = 'permission prompt'
    entry.screen = 'Do you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n'
    writeEntries(readEntries().map((candidate) => (candidate.pid === pid ? entry : candidate)))
    await waitUntil(() => adapter.pendingPrompt(pid) !== null)

    await adapter.respond(pid, '1')

    // The pty's line discipline translates the \r we write into \n by the
    // time the other side reads it.
    expect(entryForPid(pid).responses).toEqual(['1\n'])
    expect(adapter.pendingPrompt(pid)).toBeNull()
  })

  it('rejects when the command cannot be spawned', async () => {
    const adapter = createRealProcessAdapter('orca-nonexistent-command-xyz')

    await expect(adapter.spawnClaude(dir)).rejects.toThrow()
  })

  it('survives a transient failure listing agent statuses without marking sessions crashed', async () => {
    const realList = createAgentStatusLister(FAKE_CLI)
    let failNext = false
    const flakyList = async (): ReturnType<typeof realList> => {
      if (failNext) {
        failNext = false
        throw new Error('simulated transient failure')
      }
      return realList()
    }

    const adapter = createRealProcessAdapter(FAKE_CLI, [], flakyList)
    const { pid } = await adapter.spawnClaude(dir)
    expect(adapter.isAlive(pid)).toBe(true)

    failNext = true
    // Give the poll timer a few ticks to run into (and recover from) the
    // simulated failure.
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(adapter.isAlive(pid)).toBe(true)
    expect(adapter.exitCode(pid)).toBeNull()
  })

  it('does not attempt to respond to a session that is no longer alive', async () => {
    const adapter = createRealProcessAdapter(FAKE_CLI)
    const { pid } = await adapter.spawnClaude(dir)

    process.kill(pid, 'SIGKILL')
    await waitUntil(() => !adapter.isAlive(pid))

    await expect(adapter.respond(pid, '1')).resolves.toBeUndefined()
  })
})
