import { useEffect } from 'react'
import { orca } from '@renderer/lib/ipc'
import { getOrCreateTerminal } from './terminalRegistry'

/**
 * Wires one session's terminal to the IPC boundary:
 *   main -> renderer : pty output  -> term.write
 *   renderer -> main : keystrokes  -> orca.writeSession
 *
 * Note: this filters the global data stream by sessionId. If pane counts grow
 * large, switch to a single global router that writes straight into the registry.
 */
export function useTerminalIpc(sessionId: string): void {
  useEffect(() => {
    const { term } = getOrCreateTerminal(sessionId)

    const offData = orca.onSessionData((e) => {
      if (e.sessionId === sessionId) term.write(e.data)
    })
    const input = term.onData((data) => orca.writeSession({ sessionId, data }))

    return () => {
      offData()
      input.dispose()
    }
  }, [sessionId])
}
