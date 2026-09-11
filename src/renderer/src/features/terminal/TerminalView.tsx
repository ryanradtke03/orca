import { useEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import { orca } from '@renderer/lib/ipc'
import { getOrCreateTerminal } from './terminalRegistry'
import { useTerminalIpc } from './useTerminalIpc'

/**
 * Thin shell: attaches the persistent Terminal for `sessionId` to this div,
 * keeps it fitted to the pane, and forwards resizes to the PTY. On unmount it
 * DETACHES but never disposes — the registry owns the instance's lifetime.
 */
export function TerminalView({ sessionId }: { sessionId: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminalIpc(sessionId)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const { term, fit } = getOrCreateTerminal(sessionId)

    term.open(el)
    fit.fit()
    orca.resizeSession({ sessionId, cols: term.cols, rows: term.rows })

    const ro = new ResizeObserver(() => {
      fit.fit()
      orca.resizeSession({ sessionId, cols: term.cols, rows: term.rows })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      el.replaceChildren() // detach xterm's DOM; do NOT term.dispose()
    }
  }, [sessionId])

  return <div ref={containerRef} className="h-full w-full" />
}
