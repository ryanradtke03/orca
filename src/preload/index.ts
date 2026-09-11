import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannel } from '@shared/ipc'
import type {
  OrcaApi,
  SpawnSessionRequest,
  WriteSessionRequest,
  ResizeSessionRequest,
  SessionDataEvent,
  SessionStatusEvent,
  SessionExitEvent
} from '@shared/ipc'

/** Subscribe to a main->renderer channel; returns an unsubscribe fn. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: OrcaApi = {
  spawnSession: (req: SpawnSessionRequest) => ipcRenderer.invoke(IpcChannel.SpawnSession, req),
  killSession: (sessionId) => ipcRenderer.invoke(IpcChannel.KillSession, sessionId),
  listSessions: () => ipcRenderer.invoke(IpcChannel.ListSessions),
  listProjects: () => ipcRenderer.invoke(IpcChannel.ListProjects),
  saveProject: (project) => ipcRenderer.invoke(IpcChannel.SaveProject, project),

  writeSession: (req: WriteSessionRequest) => ipcRenderer.send(IpcChannel.WriteSession, req),
  resizeSession: (req: ResizeSessionRequest) => ipcRenderer.send(IpcChannel.ResizeSession, req),

  onSessionData: (cb) => subscribe<SessionDataEvent>(IpcChannel.SessionData, cb),
  onSessionStatus: (cb) => subscribe<SessionStatusEvent>(IpcChannel.SessionStatus, cb),
  onSessionExit: (cb) => subscribe<SessionExitEvent>(IpcChannel.SessionExit, cb)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
