import { isMockMode } from './mock'

/**
 * Which bridge the running app is actually talking to:
 *  - `mock` - the fixture-backed fake (`npm run dev:mock`), renderer-installed.
 *  - `demo` - the real IPC path against main's seeded demo engine (`npm run dev:demo`).
 *  - `live` - the real IPC path against the production engine (`npm run dev` / build).
 */
export type LaunchMode = 'live' | 'mock' | 'demo'

/**
 * Pure precedence resolver, split out so the ordering is unit-testable without
 * touching `import.meta.env`. Mock wins over demo because mock mode replaces
 * `window.orca` outright - if both flags were somehow set, the mock bridge is
 * what the app is really running against.
 */
export function resolveLaunchMode(flags: { mock: boolean; demo: boolean }): LaunchMode {
  if (flags.mock) return 'mock'
  if (flags.demo) return 'demo'
  return 'live'
}

/**
 * True when launched via `npm run dev:demo` (ORCA_DEMO=1). Main reads the same
 * env var to pick the demo engine; the renderer sees it because the Vite config
 * adds `ORCA_` to its env prefix allowlist.
 */
export function isDemoMode(): boolean {
  return import.meta.env.ORCA_DEMO === '1'
}

/** The active launch mode, for the corner badge. */
export function activeLaunchMode(): LaunchMode {
  return resolveLaunchMode({ mock: isMockMode(), demo: isDemoMode() })
}
