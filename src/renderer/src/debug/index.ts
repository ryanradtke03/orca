/**
 * Debug-mode entry point. Launched via `npm run dev:debug` (VITE_ORCA_DEBUG=1),
 * this swaps the whole App for a blank black scratch surface (DebugScreen) that
 * still talks to the *real* `window.orca` bridge - meant for watching the
 * backend (main/engine) while it is being rebuilt. Unlike mock mode it does not
 * replace `window.orca`.
 */

/** True when the app was launched via `npm run dev:debug` (VITE_ORCA_DEBUG=1). */
export function isDebugMode(): boolean {
  return import.meta.env.VITE_ORCA_DEBUG === '1'
}
