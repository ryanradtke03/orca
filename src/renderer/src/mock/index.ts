import { createMockOrca, type MockControls } from './mock-orca'

/**
 * Mock-mode entry points (ticket #49). Kept out of the pure, unit-tested
 * mock-orca module because these touch `import.meta.env` and `window`.
 */

/** True when the app was launched via `npm run dev:mock` (VITE_ORCA_MOCK=1). */
export function isMockMode(): boolean {
  return import.meta.env.VITE_ORCA_MOCK === '1'
}

let controls: MockControls | null = null

/**
 * Replaces the preload-provided `window.orca` with a fixture-backed fake.
 * Call once, before React renders, and only when isMockMode() is true.
 */
export function installMockOrca(): void {
  const mock = createMockOrca()
  window.orca = mock.api
  controls = mock.controls
}

/** The dev-only controls of the installed mock (Home populated/empty toggle). */
export function getMockControls(): MockControls {
  if (!controls) throw new Error('Mock orca is not installed - call installMockOrca() first')
  return controls
}
