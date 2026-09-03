import { BrowserWindow, dialog, ipcMain } from 'electron'
import { realpath } from 'fs/promises'
import type { Engine } from './engine/engine'
import { IPC_CHANNELS, type MergeMode } from '../shared/ipc-contract'

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

    // Resolved the same way Discovery resolves a session's Project path
    // (`git rev-parse --show-toplevel`, which follows symlinks) - otherwise
    // a Project added at a symlinked path (e.g. macOS's /tmp) would never
    // match a later-discovered Session for that same repo, and Discovery
    // would create a duplicate Project for it instead.
    const path = await realpath(result.filePaths[0])

    return engine.addProject(path)
  })

  ipcMain.handle(IPC_CHANNELS.spawnSession, (_event, projectId: string) =>
    engine.spawnSession(projectId)
  )

  ipcMain.handle(IPC_CHANNELS.listSessions, () => engine.listSessions())

  ipcMain.handle(IPC_CHANNELS.refreshSessionStatuses, () => engine.refreshSessionStatuses())

  ipcMain.handle(IPC_CHANNELS.stopSession, (_event, sessionId: string) =>
    engine.stopSession(sessionId)
  )

  ipcMain.handle(IPC_CHANNELS.respondToPrompt, (_event, sessionId: string, response: string) =>
    engine.respondToPrompt(sessionId, response)
  )

  ipcMain.handle(IPC_CHANNELS.getDiff, (_event, sessionId: string) => engine.getDiff(sessionId))

  ipcMain.handle(
    IPC_CHANNELS.setProjectMergeMode,
    (_event, projectId: string, mergeMode: MergeMode) =>
      engine.setProjectMergeMode(projectId, mergeMode)
  )

  ipcMain.handle(IPC_CHANNELS.requestMerge, (_event, sessionId: string) =>
    engine.requestMerge(sessionId)
  )

  ipcMain.handle(IPC_CHANNELS.discardWorktree, (_event, sessionId: string) =>
    engine.discardWorktree(sessionId)
  )

  ipcMain.handle(IPC_CHANNELS.adoptSession, (_event, pid: number, directory: string) =>
    engine.adoptSession(pid, directory)
  )
}
