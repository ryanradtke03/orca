import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { Engine } from './engine/engine'
import { IPC_CHANNELS } from '../shared/ipc-contract'

export function registerIpcHandlers(engine: Engine): void {
  ipcMain.handle(IPC_CHANNELS.ping, () => engine.ping())

  ipcMain.handle(IPC_CHANNELS.listProjects, () => engine.listProjects())

  ipcMain.handle(IPC_CHANNELS.addProjectViaDialog, async () => {
    const window = BrowserWindow.getFocusedWindow()
    const options = { properties: ['openDirectory' as const] }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) return null

    return engine.addProject(result.filePaths[0])
  })

  ipcMain.handle(IPC_CHANNELS.spawnSession, (_event, projectId: string) =>
    engine.spawnSession(projectId)
  )

  ipcMain.handle(IPC_CHANNELS.listSessions, () => engine.listSessions())

  ipcMain.handle(IPC_CHANNELS.refreshSessionStatuses, () => engine.refreshSessionStatuses())

  ipcMain.handle(IPC_CHANNELS.stopSession, (_event, sessionId: string) =>
    engine.stopSession(sessionId)
  )
}
