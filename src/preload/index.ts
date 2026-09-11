import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type OrcaApi } from '../shared/ipc-contract'

const orca: OrcaApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.listProjects),
  addProjectViaDialog: () => ipcRenderer.invoke(IPC_CHANNELS.addProjectViaDialog),
  spawnSession: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.spawnSession, projectId),
  listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.listSessions),
  refreshSessionStatuses: () => ipcRenderer.invoke(IPC_CHANNELS.refreshSessionStatuses),
  stopSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.stopSession, sessionId),
  respondToPrompt: (sessionId, response) =>
    ipcRenderer.invoke(IPC_CHANNELS.respondToPrompt, sessionId, response),
  getDiff: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.getDiff, sessionId),
  getTranscript: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.getTranscript, sessionId),
  setProjectMergeMode: (projectId, mergeMode) =>
    ipcRenderer.invoke(IPC_CHANNELS.setProjectMergeMode, projectId, mergeMode),
  requestMerge: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.requestMerge, sessionId),
  discardWorktree: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.discardWorktree, sessionId),
  removeSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.removeSession, sessionId),
  removeProject: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.removeProject, projectId),
  adoptSession: (pid, directory) => ipcRenderer.invoke(IPC_CHANNELS.adoptSession, pid, directory)
}

// In mock mode (`npm run dev:mock`) the renderer installs its own
// fixture-backed `window.orca`. contextBridge exposes a read-only,
// non-configurable property, so exposing the real bridge here would make the
// renderer's swap throw ("Cannot assign to read only property 'orca'") and
// blank the window. Skip it so the renderer owns `window.orca` in mock mode.
// (The preload's tsconfig doesn't pull in vite/client, so `import.meta.env`
// isn't typed here; the cast is erased at build time and Vite still inlines
// the value.)
const mockMode = (import.meta as unknown as { env?: { VITE_ORCA_MOCK?: string } }).env?.VITE_ORCA_MOCK === '1'
if (!mockMode) {
  contextBridge.exposeInMainWorld('orca', orca)
}
