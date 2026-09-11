import { ipcMain, BrowserWindow } from 'electron'
import { IpcChannel } from '@shared/ipc'
import type {
  SpawnSessionRequest,
  WriteSessionRequest,
  ResizeSessionRequest
} from '@shared/ipc'
import type { Project } from '@shared/domain'
import { PtyManager } from '../pty/manager'
import { loadProjects, saveProject } from '../persistence'

/**
 * Single place the boundary is wired. `invoke/handle` for request/response,
 * `on` for high-frequency fire-and-forget, and manager events pushed to every
 * renderer via webContents.send.
 */
export function registerIpcHandlers(): PtyManager {
  const manager = new PtyManager()

  // request / response
  ipcMain.handle(IpcChannel.SpawnSession, (_e, req: SpawnSessionRequest) => manager.spawn(req))
  ipcMain.handle(IpcChannel.KillSession, (_e, sessionId: string) => manager.kill(sessionId))
  ipcMain.handle(IpcChannel.ListSessions, () => manager.list())
  ipcMain.handle(IpcChannel.ListProjects, () => loadProjects())
  ipcMain.handle(IpcChannel.SaveProject, (_e, project: Project) => saveProject(project))

  // high-frequency, fire-and-forget
  ipcMain.on(IpcChannel.WriteSession, (_e, req: WriteSessionRequest) =>
    manager.write(req.sessionId, req.data)
  )
  ipcMain.on(IpcChannel.ResizeSession, (_e, req: ResizeSessionRequest) =>
    manager.resize(req.sessionId, req.cols, req.rows)
  )

  // main -> all renderers (streaming)
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload)
    }
  }
  manager.on('data', (e) => broadcast(IpcChannel.SessionData, e))
  manager.on('exit', (e) => broadcast(IpcChannel.SessionExit, e))

  return manager
}
