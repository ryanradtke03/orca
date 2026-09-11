import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

/**
 * xterm `Terminal` instances live HERE, outside React, keyed by sessionId.
 *
 * Why: dragging a terminal changes its position in the layout tree, which would
 * unmount/remount a position-keyed React component and destroy the terminal
 * (blanking scrollback, orphaning the PTY stream). By owning the instances in
 * this registry and keying panes by sessionId, the Terminal survives re-layout;
 * <TerminalView> just re-attaches the same instance to whatever div it lands in.
 */
export interface TerminalEntry {
  term: Terminal
  fit: FitAddon
}

const registry = new Map<string, TerminalEntry>()

export function getOrCreateTerminal(sessionId: string): TerminalEntry {
  let entry = registry.get(sessionId)
  if (!entry) {
    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      theme: { background: '#0a0a0a' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    entry = { term, fit }
    registry.set(sessionId, entry)
  }
  return entry
}

/** Call only when a session is truly gone (exited + closed), never on re-layout. */
export function disposeTerminal(sessionId: string): void {
  registry.get(sessionId)?.term.dispose()
  registry.delete(sessionId)
}
