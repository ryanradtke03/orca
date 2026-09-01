import { ipcMain } from 'electron'
import type { Engine } from './engine/engine'
import { IPC_CHANNELS } from '../shared/ipc-contract'

export function registerIpcHandlers(engine: Engine): void {
  ipcMain.handle(IPC_CHANNELS.ping, () => engine.ping())
}
