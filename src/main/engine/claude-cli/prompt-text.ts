import { Terminal } from '@xterm/headless'

// Wide/tall enough that a permission dialog's command block and option list
// never wrap or get pushed off the tracked scrollback. The pty real-process-
// adapter.ts attaches with must use these same dimensions - extractPromptText
// is validated against screens rendered at this exact size.
export const TERMINAL_COLS = 220
export const TERMINAL_ROWS = 60

/**
 * Renders a chunk of raw terminal output (as produced by a real TTY session -
 * cursor-addressed screen redraws, not append-only text) into the plain rows
 * that would actually be visible on screen. Claude Code's TUI redraws the
 * whole screen rather than emitting scrolling lines, so naively stripping
 * ANSI codes from the raw bytes garbles interleaved cursor-positioned
 * fragments; a real terminal emulator is needed to resolve them into rows.
 */
export function renderScreen(rawOutput: string): Promise<string[]> {
  const terminal = new Terminal({
    cols: TERMINAL_COLS,
    rows: TERMINAL_ROWS,
    allowProposedApi: true
  })

  return new Promise((resolve) => {
    terminal.write(rawOutput, () => {
      const buffer = terminal.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buffer.length; i++) {
        lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
      }
      terminal.dispose()
      resolve(lines)
    })
  })
}

// The glyph Claude Code's TUI puts on the currently-selected option of any
// dialog (permission prompt or clarifying question).
const CURSOR_MARKER = '❯'

// A dialog box's top border - a long run of the same box-drawing (or plain
// ASCII) rule character.
const RULE_LINE = /^([─━=_-])\1{9,}$/

// How far above the cursor we're willing to look for the dialog's question -
// bounds how much unrelated earlier scrollback a very tall dialog (or a
// screen with no rule line at all) could pull in.
const MAX_LOOKBACK = 12

/**
 * Given the current screen's rendered rows, returns the on-screen dialog a
 * pending prompt is rendered as. Claude Code's TUI draws these as a box with
 * a question, a numbered option list (its current selection marked with
 * CURSOR_MARKER), and often single blank spacer rows *within* the box - so a
 * plain "last blank-separated paragraph" split cuts the box apart. Instead
 * this anchors on the last cursor marker on screen (the one furthest down,
 * since anything above it is either older scrollback or, for a clarifying
 * question, the echoed prompt that kicked it off) and walks upward only
 * until a real boundary: the box's top rule, a genuine blank-to-blank gap,
 * or the lookback limit.
 */
export function extractPromptText(lines: string[]): string {
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') end--
  if (end === 0) return ''

  let cursorRow = -1
  for (let i = end - 1; i >= 0; i--) {
    if (lines[i].includes(CURSOR_MARKER)) {
      cursorRow = i
      break
    }
  }

  if (cursorRow === -1) {
    let start = end
    while (start > 0 && lines[start - 1].trim() !== '') start--
    return lines.slice(start, end).join('\n')
  }

  let start = cursorRow
  for (let i = cursorRow - 1; i >= 0 && cursorRow - i <= MAX_LOOKBACK; i--) {
    if (RULE_LINE.test(lines[i].trim())) break
    if (lines[i].trim() === '' && lines[i - 1]?.trim() === '') break
    start = i
  }

  return lines.slice(start, end).join('\n')
}
