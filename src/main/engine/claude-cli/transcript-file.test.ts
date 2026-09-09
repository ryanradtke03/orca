import { describe, expect, it } from 'vitest'
import { extractMessageText, parseTranscript } from './transcript-file'

// A trimmed but faithful sample of the lines a real ~/.claude/projects/…jsonl
// transcript interleaves - conversation turns amid bookkeeping.
function line(object: unknown): string {
  return JSON.stringify(object)
}

describe('extractMessageText', () => {
  it('returns a trimmed string turn as-is', () => {
    expect(extractMessageText('  hello world  ')).toBe('hello world')
  })

  it('keeps only text parts of an array turn, dropping thinking/tool_use', () => {
    const content = [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'First.' },
      { type: 'tool_use', name: 'Bash', input: {} },
      { type: 'text', text: 'Second.' }
    ]
    expect(extractMessageText(content)).toBe('First.\n\nSecond.')
  })

  it('is empty for a tool_result-only array', () => {
    expect(extractMessageText([{ type: 'tool_result' }])).toBe('')
  })
})

describe('parseTranscript', () => {
  it('extracts user and assistant turns in order, from the real line shape', () => {
    const content = [
      line({ type: 'mode', mode: 'default', sessionId: 's' }),
      line({
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-09-03T23:41:17.707Z',
        isSidechain: false,
        message: { role: 'user', content: 'Create merge-test.txt' }
      }),
      line({
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-09-03T23:41:22.000Z',
        message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }] }
      }),
      line({
        type: 'assistant',
        uuid: 'a2',
        timestamp: '2026-09-03T23:41:30.988Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }
      })
    ].join('\n')

    expect(parseTranscript(content)).toEqual([
      { id: 'u1', role: 'user', text: 'Create merge-test.txt', timestamp: Date.parse('2026-09-03T23:41:17.707Z') },
      { id: 'a2', role: 'assistant', text: 'Done.', timestamp: Date.parse('2026-09-03T23:41:30.988Z') }
    ])
  })

  it('skips tool_result user turns (array content, no text parts)', () => {
    const content = [
      line({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'run it' } }),
      line({ type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } })
    ].join('\n')

    expect(parseTranscript(content).map((m) => m.id)).toEqual(['u1'])
  })

  it('skips sub-agent sidechain turns', () => {
    const content = [
      line({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'main thread' } }),
      line({ type: 'assistant', uuid: 'a1', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'sidechain' }] } })
    ].join('\n')

    expect(parseTranscript(content).map((m) => m.id)).toEqual(['u1'])
  })

  it('tolerates blank and malformed lines', () => {
    const content = [
      '',
      '{ not json',
      line({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'still parsed' } }),
      '   '
    ].join('\n')

    expect(parseTranscript(content).map((m) => m.text)).toEqual(['still parsed'])
  })

  it('falls back to a generated id and a zero timestamp when they are absent', () => {
    const content = line({ type: 'user', message: { role: 'user', content: 'no uuid' } })
    const [message] = parseTranscript(content)
    expect(message.text).toBe('no uuid')
    expect(message.timestamp).toBe(0)
    expect(message.id).toMatch(/[0-9a-f-]{36}/)
  })

  it('returns nothing for a transcript with no conversation turns', () => {
    const content = [line({ type: 'mode', mode: 'default' }), line({ type: 'cost-state' })].join('\n')
    expect(parseTranscript(content)).toEqual([])
  })
})
