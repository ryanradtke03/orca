import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRealPersistenceAdapter } from './real-persistence-adapter'

describe('createRealPersistenceAdapter', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orca-persistence-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('defaults to zero sessions when no state file exists yet', async () => {
    const adapter = createRealPersistenceAdapter(join(dir, 'state.json'))

    await expect(adapter.loadSessionCount()).resolves.toBe(0)
  })

  it('reads the persisted session count from the state file', async () => {
    const stateFilePath = join(dir, 'state.json')
    await writeFile(stateFilePath, JSON.stringify({ sessionCount: 5 }))
    const adapter = createRealPersistenceAdapter(stateFilePath)

    await expect(adapter.loadSessionCount()).resolves.toBe(5)
  })

  it('defaults to zero sessions when the state file is not valid JSON', async () => {
    const stateFilePath = join(dir, 'state.json')
    await writeFile(stateFilePath, '{not valid json')
    const adapter = createRealPersistenceAdapter(stateFilePath)

    await expect(adapter.loadSessionCount()).resolves.toBe(0)
  })

  it('defaults to zero sessions when sessionCount is not a number', async () => {
    const stateFilePath = join(dir, 'state.json')
    await writeFile(stateFilePath, JSON.stringify({ sessionCount: '5' }))
    const adapter = createRealPersistenceAdapter(stateFilePath)

    await expect(adapter.loadSessionCount()).resolves.toBe(0)
  })
})
