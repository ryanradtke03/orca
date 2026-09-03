import { describe, expect, it } from 'vitest'
import { createAgentStatusLister, promptTypeFromStatus } from './agent-status'

describe('createAgentStatusLister', () => {
  it('parses the JSON array printed to stdout', async () => {
    const script = `process.stdout.write(JSON.stringify([{ id: 'abc', pid: 123, status: 'waiting', waitingFor: 'permission prompt' }]))`
    const listAgentStatuses = createAgentStatusLister(process.execPath, ['-e', script])

    const entries = await listAgentStatuses()

    expect(entries).toEqual([
      { id: 'abc', pid: 123, status: 'waiting', waitingFor: 'permission prompt' }
    ])
  })

  it('returns an empty list when the command fails', async () => {
    const listAgentStatuses = createAgentStatusLister('orca-nonexistent-command-xyz')

    await expect(listAgentStatuses()).resolves.toEqual([])
  })

  it('returns an empty list when the output is not valid JSON', async () => {
    const listAgentStatuses = createAgentStatusLister(process.execPath, [
      '-e',
      "process.stdout.write('not json')"
    ])

    await expect(listAgentStatuses()).resolves.toEqual([])
  })
})

describe('promptTypeFromStatus', () => {
  it('returns null when there is no entry', () => {
    expect(promptTypeFromStatus(undefined)).toBeNull()
  })

  it('returns null when the entry is not waiting', () => {
    expect(promptTypeFromStatus({ status: 'busy' })).toBeNull()
    expect(promptTypeFromStatus({ status: 'idle' })).toBeNull()
  })

  it('classifies a permission prompt', () => {
    expect(promptTypeFromStatus({ status: 'waiting', waitingFor: 'permission prompt' })).toBe(
      'permission'
    )
  })

  it('classifies anything else being waited on as input', () => {
    expect(promptTypeFromStatus({ status: 'waiting', waitingFor: 'input needed' })).toBe('input')
  })
})
