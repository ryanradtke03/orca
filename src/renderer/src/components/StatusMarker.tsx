import type { SessionStatus } from '../../../shared/ipc-contract'

export function StatusMarker({ status }: { status: SessionStatus }): React.JSX.Element {
  if (status === 'waiting-on-permission') {
    return <span className="h-[7px] w-[7px] rotate-45 bg-accent" />
  }
  if (status === 'waiting-on-input') {
    return <span className="h-2 w-2 rounded-full border-2 border-accent" />
  }
  if (status === 'done') {
    return <span>✓</span>
  }
  if (status === 'errored') {
    return <span className="text-danger">✕</span>
  }
  const dotClass =
    status === 'running' ? 'bg-accent' : status === 'idle' ? 'bg-white/22' : 'bg-white/30'
  return <span className={`inline-block h-[7px] w-[7px] rounded-full ${dotClass}`} />
}
