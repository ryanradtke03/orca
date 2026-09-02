import { describe, expect, it } from 'vitest'
import { detectPendingPrompt, stripAnsi } from './prompt-detection'

const ESC = '\x1B'

describe('stripAnsi', () => {
  it('removes CSI escape sequences', () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m text`)).toBe('red text')
  })

  it('removes OSC escape sequences', () => {
    expect(stripAnsi(`${ESC}]0;window title${ESC}\\rest`)).toBe('rest')
  })

  it('leaves plain text untouched', () => {
    expect(stripAnsi('hello world')).toBe('hello world')
  })
})

describe('detectPendingPrompt', () => {
  it('returns null when there is no options list at the tail', () => {
    const output = 'Reading files...\nRunning tests...\n'

    expect(detectPendingPrompt(output)).toBeNull()
  })

  it('detects a permission prompt from the Yes/No options dialog', () => {
    const output = [
      'Bash command',
      '',
      '  npm install',
      '',
      'Do you want to proceed?',
      '❯ 1. Yes',
      "  2. Yes, and don't ask again for npm commands in this session",
      '  3. No, and tell Claude what to do differently'
    ].join('\n')

    expect(detectPendingPrompt(output)).toEqual({
      type: 'permission',
      text: expect.stringContaining('Do you want to proceed?')
    })
  })

  it('detects an input prompt from a clarifying question with numbered options', () => {
    const output = [
      'Which authentication approach should I use?',
      '❯ 1. OAuth',
      '  2. API key',
      '  3. Let me decide'
    ].join('\n')

    expect(detectPendingPrompt(output)).toEqual({
      type: 'input',
      text: expect.stringContaining('Which authentication approach')
    })
  })

  it('strips ANSI styling before matching', () => {
    const output = [
      `${ESC}[1mDo you want to proceed?${ESC}[0m`,
      `${ESC}[32m❯ 1. Yes${ESC}[0m`,
      '  2. No'
    ].join('\n')

    const prompt = detectPendingPrompt(output)

    expect(prompt).toEqual({
      type: 'permission',
      text: 'Do you want to proceed?\n❯ 1. Yes\n  2. No'
    })
  })

  it('does not mistake an ordinary numbered summary for a prompt', () => {
    const output = ["Here's what I did:", '1. Fixed the bug', '2. Added tests'].join('\n')

    expect(detectPendingPrompt(output)).toBeNull()
  })

  it('only inspects the trailing paragraph, ignoring earlier numbered lists', () => {
    const output = [
      '1. First I read the file',
      '2. Then I ran the tests',
      '',
      'All tests passed.'
    ].join('\n')

    expect(detectPendingPrompt(output)).toBeNull()
  })

  it('returns null once the prompt block has scrolled out of the scan window', () => {
    const stalePrompt = 'Do you want to proceed?\n❯ 1. Yes\n  2. No'
    const filler = 'x'.repeat(5000)

    expect(detectPendingPrompt(`${stalePrompt}\n\n${filler}`)).toBeNull()
  })
})
