import type { OrcaApi } from '../../../shared/ipc-contract'

/**
 * The single seam between the renderer app and the main process. Every IPC
 * call flows through here:
 *
 *     views  ->  hooks  ->  orca-client  ->  window.orca
 *
 * No other app module should reach for `window.orca` directly - a grep for it
 * outside `api/`, `mock/`, and `debug/` should come back empty. (mock and debug
 * are the exception: they *provide* the bridge rather than consume it.)
 *
 * Each method delegates at call time (not at import), so mock mode's swap
 * (installMockOrca) and the real preload bridge both work unchanged. This is
 * also the one place cross-cutting error normalization would go, if we ever
 * want it - today it is a pure pass-through and behaviour is identical to
 * calling `window.orca` directly.
 */
export const orca: OrcaApi = {
  ping: () => window.orca.ping(),
  listProjects: () => window.orca.listProjects(),
  addProjectViaDialog: () => window.orca.addProjectViaDialog(),
  spawnSession: (projectId) => window.orca.spawnSession(projectId),
  listSessions: () => window.orca.listSessions(),
  refreshSessionStatuses: () => window.orca.refreshSessionStatuses(),
  stopSession: (sessionId) => window.orca.stopSession(sessionId),
  respondToPrompt: (sessionId, response) => window.orca.respondToPrompt(sessionId, response),
  getDiff: (sessionId) => window.orca.getDiff(sessionId),
  getTranscript: (sessionId) => window.orca.getTranscript(sessionId),
  setProjectMergeMode: (projectId, mergeMode) => window.orca.setProjectMergeMode(projectId, mergeMode),
  requestMerge: (sessionId) => window.orca.requestMerge(sessionId),
  discardWorktree: (sessionId) => window.orca.discardWorktree(sessionId),
  adoptSession: (pid, directory) => window.orca.adoptSession(pid, directory),
}
