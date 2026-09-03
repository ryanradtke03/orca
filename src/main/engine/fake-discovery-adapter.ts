import type { DiscoveredSession, DiscoveryAdapter } from './adapters'

export interface FakeDiscoveryAdapter extends DiscoveryAdapter {
  // Queues a session for the next scan() to report - simulating a `claude`
  // process discovery would find, without any real process or disk scan.
  simulateSession(session: DiscoveredSession): void
  // Simulates the discovered process going away (stopped, crashed, or
  // finished) - a later scan() no longer reports it.
  removeSession(pid: number): void
}

export function createFakeDiscoveryAdapter(
  seed: { sessions?: DiscoveredSession[] } = {}
): FakeDiscoveryAdapter {
  let sessions = seed.sessions ?? []

  return {
    async scan() {
      return sessions
    },

    simulateSession(session: DiscoveredSession): void {
      sessions = [...sessions, session]
    },

    removeSession(pid: number): void {
      sessions = sessions.filter((session) => session.pid !== pid)
    }
  }
}
