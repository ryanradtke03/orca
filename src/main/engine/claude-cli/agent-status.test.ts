import { describe, expect, it } from 'vitest'
import {
  classifyPromptText,
  createAgentStatusLister,
  isWaitingOnUser,
  terminalExitCode,
  transcriptSessionId
} from './agent-status'

describe('createAgentStatusLister', () => {
  it('parses the JSON array printed to stdout', async () => {
    const script = `process.stdout.write(JSON.stringify([{ id: 'abc', pid: 123, status: 'waiting', waitingFor: 'permission prompt' }]))`
    const listAgentStatuses = createAgentStatusLister(process.execPath, ['-e', script])

    const entries = await listAgentStatuses()

    expect(entries).toEqual([
      { id: 'abc', pid: 123, status: 'waiting', waitingFor: 'permission prompt' }
    ])
  })

  it('rejects when the command fails', async () => {
    const listAgentStatuses = createAgentStatusLister('orca-nonexistent-command-xyz')

    await expect(listAgentStatuses()).rejects.toThrow()
  })

  it('rejects when the output is not valid JSON', async () => {
    const listAgentStatuses = createAgentStatusLister(process.execPath, [
      '-e',
      "process.stdout.write('not json')"
    ])

    await expect(listAgentStatuses()).rejects.toThrow()
  })
})

describe('terminalExitCode', () => {
  it('maps done to 0 and failed/crashed to 1', () => {
    expect(terminalExitCode({ state: 'done' })).toBe(0)
    expect(terminalExitCode({ state: 'failed' })).toBe(1)
    expect(terminalExitCode({ state: 'crashed' })).toBe(1)
  })

  it('returns null while the session is still alive', () => {
    expect(terminalExitCode({ state: 'blocked' })).toBeNull()
    expect(terminalExitCode({ status: 'busy' })).toBeNull()
    expect(terminalExitCode(undefined)).toBeNull()
  })
})

describe('isWaitingOnUser', () => {
  it('recognizes the current signal (state: blocked)', () => {
    expect(isWaitingOnUser({ state: 'blocked' })).toBe(true)
  })

  it('recognizes the older signal (status: waiting) for cross-version support', () => {
    expect(isWaitingOnUser({ status: 'waiting' })).toBe(true)
  })

  it('is false for a working or idle session', () => {
    expect(isWaitingOnUser({ state: 'running', status: 'busy' })).toBe(false)
    expect(isWaitingOnUser({ status: 'idle' })).toBe(false)
    expect(isWaitingOnUser(undefined)).toBe(false)
  })
})

describe('transcriptSessionId', () => {
  it('prefers the full sessionId (the transcript filename)', () => {
    expect(transcriptSessionId({ id: 'a49b4cbc', sessionId: 'a49b4cbc-48c4-4943-9d2c-b67619c50be6' })).toBe(
      'a49b4cbc-48c4-4943-9d2c-b67619c50be6'
    )
  })

  it('falls back to the short id when no sessionId is present', () => {
    expect(transcriptSessionId({ id: 'a49b4cbc' })).toBe('a49b4cbc')
  })
})

describe('classifyPromptText', () => {
  it('uses waitingFor when the CLI still tags the prompt kind', () => {
    expect(classifyPromptText('anything', 'permission prompt')).toBe('permission')
    expect(classifyPromptText('Do you want to proceed?', 'input needed')).toBe('input')
  })

  it('classifies from the rendered dialog when waitingFor is absent', () => {
    expect(classifyPromptText('Do you want to proceed?\n1. Yes\n2. No')).toBe('permission')
    expect(classifyPromptText("Bash(rm)\nYes, and don't ask again")).toBe('permission')
    expect(classifyPromptText('Which auth approach should I use?')).toBe('input')
    expect(classifyPromptText('')).toBe('input')
  })
})
