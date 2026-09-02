import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp, readFile, realpath, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRealProcessAdapter } from './real-process-adapter'

const execFileAsync = promisify(execFile)

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
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

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orca-process-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('spawns the process rooted at the given directory', async () => {
    const adapter = createRealProcessAdapter('node', [
      '-e',
      "require('fs').writeFileSync('cwd-marker.txt', process.cwd())"
    ])

    await adapter.spawnClaude(dir)

    await waitUntil(() => existsSync(join(dir, 'cwd-marker.txt')))
    const written = await readFile(join(dir, 'cwd-marker.txt'), 'utf-8')
    expect(written).toBe(await realpath(dir))
  })

  it('reports the process alive right after spawning, then not alive with its exit code once it exits', async () => {
    const adapter = createRealProcessAdapter('node', ['-e', 'process.exit(7)'])

    const { pid } = await adapter.spawnClaude(dir)

    expect(adapter.isAlive(pid)).toBe(true)
    expect(adapter.exitCode(pid)).toBeNull()

    await waitUntil(() => !adapter.isAlive(pid))

    expect(adapter.exitCode(pid)).toBe(7)
  })

  it('stops a running process, marking it not alive', async () => {
    const adapter = createRealProcessAdapter('node', ['-e', 'setTimeout(() => {}, 5000)'])

    const { pid } = await adapter.spawnClaude(dir)
    expect(adapter.isAlive(pid)).toBe(true)

    await adapter.stop(pid)

    await waitUntil(() => !adapter.isAlive(pid))
    expect(isOsProcessAlive(pid)).toBe(false)
  })

  it('resolves without throwing when stopping a pid that is already gone', async () => {
    const adapter = createRealProcessAdapter('node', ['-e', 'process.exit(0)'])

    const { pid } = await adapter.spawnClaude(dir)
    await waitUntil(() => !adapter.isAlive(pid))

    await expect(adapter.stop(pid)).resolves.toBeUndefined()
  })

  it('reports no pending prompt while the process has only printed plain output', async () => {
    const adapter = createRealProcessAdapter('node', [
      '-e',
      "process.stdout.write('Reading files...\\n'); setTimeout(() => {}, 5000)"
    ])

    const { pid } = await adapter.spawnClaude(dir)

    await waitUntil(() => adapter.isAlive(pid))
    expect(adapter.pendingPrompt(pid)).toBeNull()
  })

  it('detects a permission prompt once the process prints one to stdout', async () => {
    const script = [
      "process.stdout.write('Do you want to proceed?\\n\\u276f 1. Yes\\n  2. No\\n')",
      'setTimeout(() => {}, 5000)'
    ].join('; ')
    const adapter = createRealProcessAdapter('node', ['-e', script])

    const { pid } = await adapter.spawnClaude(dir)

    await waitUntil(() => adapter.pendingPrompt(pid) !== null)
    expect(adapter.pendingPrompt(pid)).toEqual({
      type: 'permission',
      text: expect.stringContaining('Do you want to proceed?')
    })
  })

  it('sends a response to the process stdin and clears the pending prompt', async () => {
    const responseMarker = join(dir, 'response.txt')
    const script = [
      "process.stdout.write('Do you want to proceed?\\n\\u276f 1. Yes\\n  2. No\\n')",
      `process.stdin.on('data', (d) => { require('fs').writeFileSync(${JSON.stringify(responseMarker)}, d.toString()); process.exit(0) })`
    ].join('; ')
    const adapter = createRealProcessAdapter('node', ['-e', script])

    const { pid } = await adapter.spawnClaude(dir)
    await waitUntil(() => adapter.pendingPrompt(pid) !== null)

    await adapter.respond(pid, 'yes')

    await waitUntil(() => existsSync(responseMarker))
    expect(await readFile(responseMarker, 'utf-8')).toBe('yes\n')
    expect(adapter.pendingPrompt(pid)).toBeNull()
  })

  it('rejects when the command cannot be spawned', async () => {
    const adapter = createRealProcessAdapter('orca-nonexistent-command-xyz')

    await expect(adapter.spawnClaude(dir)).rejects.toThrow()
  })

  it('spawns a detached process that keeps running after its immediate parent exits', async () => {
    const harnessPath = join(__dirname, 'real-process-adapter.detach-harness.cjs')
    const targetArgs = ['-e', 'setTimeout(() => {}, 5000)']

    const startedAt = Date.now()
    const { stdout } = await execFileAsync('node', [
      harnessPath,
      'node',
      JSON.stringify(targetArgs),
      dir
    ])
    const harnessDurationMs = Date.now() - startedAt

    const pid = Number(stdout.trim())
    try {
      expect(Number.isInteger(pid)).toBe(true)

      // The harness (standing in for Orca) has already fully exited at this
      // point, since execFile only resolves once its process closes. It spawned
      // its target with the same detached + unref() configuration
      // real-process-adapter uses, so the target should have outlived it.
      expect(harnessDurationMs).toBeLessThan(2000)
      expect(isOsProcessAlive(pid)).toBe(true)
    } finally {
      if (Number.isInteger(pid)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // already exited
        }
      }
    }
  })
})
