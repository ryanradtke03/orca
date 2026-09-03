import type { DiscoveredSession, DiscoveryAdapter } from '../../adapters'

export interface FakeDiscoveryAdapter extends DiscoveryAdapter {
  // Queues a session for the next scan() to report - simulating a `claude`
  // process discovery would find, without any real process or disk scan.
  simulateSession(session: DiscoveredSession): void
  // Simulates the discovered process going away (stopped, crashed, or
  // finished) - a later scan() no longer reports it.
  removeSession(pid: number): void
  // Queues a session resolveManual() can find by pid, without scan() ever
  // reporting it - simulating the scenario Adopt exists for: a session
  // Discovery's automatic scan can't find on its own.
  simulateManualOnlySession(session: DiscoveredSession): void
}

export function createFakeDiscoveryAdapter(
  seed: { sessions?: DiscoveredSession[] } = {}
): FakeDiscoveryAdapter {
  let sessions = seed.sessions ?? []
  let manualOnlySessions: DiscoveredSession[] = []

  return {
    async scan() {
      return sessions
    },

    simulateSession(session: DiscoveredSession): void {
      sessions = [...sessions, session]
    },

    removeSession(pid: number): void {
      sessions = sessions.filter((session) => session.pid !== pid)
    },

    simulateManualOnlySession(session: DiscoveredSession): void {
      manualOnlySessions = [...manualOnlySessions, session]
    },

    async resolveManual(pid: number, directory: string): Promise<DiscoveredSession | null> {
      // Only the pid is used to find a matching seeded session - the
      // caller-supplied directory becomes the resolved cwd (mirroring the
      // real adapter, which treats it as authoritative), but projectPath/
      // branch/baseRef are whatever the test seeded, since a fake can't
      // derive them via real git commands the way the real adapter does.
      // Tests wanting those to reflect `directory` should seed them that way.
      const match = sessions.find((session) => session.pid === pid) ??
        manualOnlySessions.find((session) => session.pid === pid)
      if (!match) return null
      return { ...match, cwd: directory }
    }
  }
}
