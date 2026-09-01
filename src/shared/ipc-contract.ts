export interface PingResult {
  ok: true
  sessionCount: number
}

export const IPC_CHANNELS = {
  ping: 'engine:ping'
} as const

export interface OrcaApi {
  ping(): Promise<PingResult>
}
