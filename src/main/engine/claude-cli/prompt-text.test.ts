import { describe, expect, it } from 'vitest'
import { extractPromptText, renderScreen } from './prompt-text'

describe('extractPromptText', () => {
  it('returns an empty string when every row is blank', () => {
    expect(extractPromptText(['', '', ''])).toBe('')
  })

  it('returns an empty string when nothing on screen has a cursor marker', () => {
    expect(extractPromptText(['Reading files...', 'Running tests...'])).toBe(
      'Reading files...\nRunning tests...'
    )
  })

  it('returns the trailing dialog, trimming blank rows below it', () => {
    const lines = ['Do you want to proceed?', '❯ 1. Yes', '  2. No', '', '', '']

    expect(extractPromptText(lines)).toBe('Do you want to proceed?\n❯ 1. Yes\n  2. No')
  })

  it('keeps single blank rows inside the dialog box rather than treating them as a break', () => {
    // Claude Code's real dialogs use single blank rows as spacing between a
    // command block and the question - a genuine turn boundary needs two.
    const lines = [
      'Bash command',
      '',
      '  npm install',
      '',
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No'
    ]

    expect(extractPromptText(lines)).toBe(
      'Bash command\n\n  npm install\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No'
    )
  })

  it('stops at a real double-blank-row gap above the dialog', () => {
    const lines = [
      "Here's what I did earlier:",
      '1. Fixed the bug',
      '2. Added tests',
      '',
      '',
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No'
    ]

    expect(extractPromptText(lines)).toBe('Do you want to proceed?\n❯ 1. Yes\n  2. No')
  })

  it('stops at the dialog box top border rather than reading past it', () => {
    const lines = [
      'unrelated earlier scrollback',
      '─'.repeat(20),
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No'
    ]

    expect(extractPromptText(lines)).toBe('Do you want to proceed?\n❯ 1. Yes\n  2. No')
  })

  it('anchors on the last cursor marker, ignoring an earlier echoed prompt line', () => {
    // A clarifying question's screen echoes the user's own message at the
    // top with a cursor-like `❯` of its own, above the dialog box's own top
    // rule; only the box below that rule is the live dialog.
    const lines = [
      '❯ some earlier message that also starts with the cursor glyph',
      '─'.repeat(20),
      'What color should the button be?',
      '',
      '❯ 1. Blue',
      '  2. Green'
    ]

    expect(extractPromptText(lines)).toBe(
      'What color should the button be?\n\n❯ 1. Blue\n  2. Green'
    )
  })

  it('includes option lines that follow a secondary rule line below the cursor', () => {
    const lines = [
      'What color should the button be?',
      '❯ 1. Blue',
      '  2. Green',
      '─'.repeat(20),
      '  3. Chat about this'
    ]

    expect(extractPromptText(lines)).toBe(
      'What color should the button be?\n❯ 1. Blue\n  2. Green\n' +
        '─'.repeat(20) +
        '\n  3. Chat about this'
    )
  })
})

describe('renderScreen', () => {
  it('resolves ANSI-styled output into plain rows', async () => {
    const lines = await renderScreen(
      '\x1B[1mDo you want to proceed?\x1B[0m\r\n\x1B[32m❯ 1. Yes\x1B[0m\r\n  2. No\r\n'
    )

    expect(lines.slice(0, 3)).toEqual(['Do you want to proceed?', '❯ 1. Yes', '  2. No'])
  })

  it('resolves cursor-addressed redraws into the final on-screen rows', async () => {
    // Move the cursor back up and overwrite, as a real TUI redraw would -
    // this only produces clean rows if something actually interprets cursor
    // positioning, unlike a plain ANSI-stripping regex.
    const raw = 'first draft\r\n\x1B[1A\x1B[2Kfinal answer\r\n'

    const lines = await renderScreen(raw)

    expect(lines[0]).toBe('final answer')
  })
})
