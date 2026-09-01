import type { OrcaApi } from '../../shared/ipc-contract'

declare global {
  interface Window {
    orca: OrcaApi
  }
}

export {}
