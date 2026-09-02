import type { PendingPrompt } from './adapters'

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1B(?:\[[0-9;?]*[a-zA-Z]|\][^\x07]*(?:\x07|\x1B\\))/g
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g

// Claude Code's interactive permission dialog always poses this question before
// its Yes/No options, distinguishing it from an open-ended clarifying question.
const PERMISSION_MARKER = /Do you want to proceed\?/i

// Both permission prompts and clarifying questions render as a numbered
// options list with a "❯" cursor glyph on the active selection — the glyph is
// what distinguishes a real interactive prompt from ordinary numbered prose
// (e.g. a closing summary like "1. Fixed the bug\n2. Added tests").
const OPTIONS_LIST_MARKER = /^\s*❯\s*\d+[.)]\s+\S/m

// How much of the tail we bother scanning for a prompt. Kept small since a
// prompt block is always near the very end of the output.
const SCAN_WINDOW = 4000

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '').replace(CONTROL_CHAR_PATTERN, '')
}

function lastParagraph(text: string): string {
  const paragraphs = text.split(/\n{2,}/)
  return paragraphs[paragraphs.length - 1].trim()
}

/**
 * Best-effort scrape of a Claude Code CLI session's raw terminal output,
 * looking for a pending permission or clarifying-question prompt at the tail.
 * Heuristic, not a protocol: the CLI has no machine-readable prompt channel
 * for the fully interactive TUI, only this rendered text.
 */
export function detectPendingPrompt(rawOutput: string): PendingPrompt | null {
  const clean = stripAnsi(rawOutput)
  const tail = clean.slice(-SCAN_WINDOW)
  const block = lastParagraph(tail)

  if (!OPTIONS_LIST_MARKER.test(block)) return null

  return {
    type: PERMISSION_MARKER.test(block) ? 'permission' : 'input',
    text: block
  }
}
