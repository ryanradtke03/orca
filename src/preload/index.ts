import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type OrcaApi } from '../shared/ipc-contract'

const orca: OrcaApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping),
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.listProjects),
  addProjectViaDialog: () => ipcRenderer.invoke(IPC_CHANNELS.addProjectViaDialog),
  spawnSession: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.spawnSession, projectId),
  listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.listSessions),
  refreshSessionStatuses: () => ipcRenderer.invoke(IPC_CHANNELS.refreshSessionStatuses)
}

contextBridge.exposeInMainWorld('orca', orca)
