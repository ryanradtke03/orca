import type { OrcaApi } from '@shared/ipc'

/**
 * The single typed entry point to the main process from the renderer.
 * Components/hooks call `orca.spawnSession(...)`, never `window.api` directly,
 * so the bridge stays swappable and mockable in tests.
 */
export const orca: OrcaApi = window.api
