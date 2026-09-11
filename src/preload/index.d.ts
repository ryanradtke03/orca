import { ElectronAPI } from '@electron-toolkit/preload'
import type { OrcaApi } from '@shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    api: OrcaApi
  }
}
