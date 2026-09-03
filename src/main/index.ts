import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { createProductionEngine } from './composition-root'
import { createDemoEngine } from './demo-engine'
import { registerIpcHandlers } from './ipc'

const SESSION_STATUS_POLL_INTERVAL_MS = 2000

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock?.setIcon(join(__dirname, '../../resources/icon.png'))
  }

  // ORCA_DEMO runs the app against seeded fake adapters (no real `claude`
  // process or git repo) so the UI - including sessions with a diff or a
  // pending prompt already attached - can be clicked through directly.
  // Gated on !app.isPackaged too so a stray ORCA_DEMO in a distributed
  // build's environment can't silently swap out real data for fake.
  const useDemoEngine = !app.isPackaged && process.env.ORCA_DEMO === '1'
  const engine = useDemoEngine ? createDemoEngine() : createProductionEngine()
  registerIpcHandlers(engine)

  setInterval(() => {
    engine.refreshSessionStatuses().catch((error) => {
      console.error('Failed to refresh session statuses:', error)
    })
  }, SESSION_STATUS_POLL_INTERVAL_MS)

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
