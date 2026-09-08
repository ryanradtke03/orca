import { describe, expect, it } from 'vitest'
import type { TranscriptMessage } from '../../shared/ipc-contract'
import { messagesToEntries, toolNameFromCommand } from './transcript-view'

describe('toolNameFromCommand', () => {
  it('pulls the tool name out of a Tool(command) string', () => {
    expect(toolNameFromCommand('Bash(rm -rf out/)')).toBe('Bash')
    expect(toolNameFromCommand('Edit(src/shared/ipc-contract.ts)')).toBe('Edit')
  })

  it('tolerates surrounding whitespace', () => {
    expect(toolNameFromCommand('  Bash(x)  ')).toBe('Bash')
  })

  it('returns undefined for text that is not shaped like a tool call', () => {
    expect(toolNameFromCommand('npm run build')).toBeUndefined()
    expect(toolNameFromCommand('(rm -rf out/)')).toBeUndefined()
    expect(toolNameFromCommand('')).toBeUndefined()
  })
})

describe('messagesToEntries', () => {
  it('wraps each message as a message entry, preserving order', () => {
    const messages: TranscriptMessage[] = [
      { id: 'm1', role: 'user', text: 'hi', timestamp: 1 },
      { id: 'm2', role: 'assistant', text: 'hello', timestamp: 2 }
    ]
    expect(messagesToEntries(messages)).toEqual([
      { kind: 'message', message: messages[0] },
      { kind: 'message', message: messages[1] }
    ])
  })

  it('maps an empty transcript to no entries', () => {
    expect(messagesToEntries([])).toEqual([])
  })
})
