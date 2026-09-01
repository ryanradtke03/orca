import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type OrcaApi } from '../shared/ipc-contract'

const orca: OrcaApi = {
  ping: () => ipcRenderer.invoke(IPC_CHANNELS.ping)
}

contextBridge.exposeInMainWorld('orca', orca)
