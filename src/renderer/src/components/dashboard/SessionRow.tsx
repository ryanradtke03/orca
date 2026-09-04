import type { Session } from '../../../../shared/ipc-contract'
import { StatusMarker } from '../StatusMarker'
import {
  canDiscardWorktree,
  canRequestMerge,
  canViewDiff,
  describeStatus,
  isAttentionStatus,
  isStoppable,
  isTerminalStatus
} from '../../session-view'

export function SessionRow({
  session,
  onOpen,
  onOpenDiff,
  onStop,
  onRequestMerge,
  onDiscardWorktree
}: {
  session: Session
  onOpen: (sessionId: string) => void
  onOpenDiff: (sessionId: string) => void
  onStop: (sessionId: string) => void
  onRequestMerge: (sessionId: string) => void
  onDiscardWorktree: (sessionId: string) => void
}): React.JSX.Element {
  const branchClass = isTerminalStatus(session.status) ? 'text-secondary' : 'text-primary'

  return (
    <div
      className="flex items-center gap-3.5 border-b border-border-faint px-6 py-2.5 last:border-b-0"
      title={session.worktreePath}
    >
      <div className="w-[11px] flex-none text-center text-[11px] text-primary">
        <StatusMarker status={session.status} />
      </div>
      <div className={`min-w-0 flex-1 truncate font-mono text-xs ${branchClass}`}>{session.branch}</div>
      <div
        className={`w-[150px] flex-none text-[9.5px] leading-none font-medium tracking-[0.09em] uppercase ${
          isAttentionStatus(session.status) ? 'text-primary' : 'text-faint'
        }`}
      >
        {describeStatus(session.status)}
      </div>
      <div className="flex flex-none items-center gap-3.5">
        <button
          type="button"
          className="border-0 bg-transparent p-0 text-[11px] text-faint hover:text-primary"
          onClick={() => onOpen(session.id)}
        >
          Open
        </button>
        {canViewDiff(session) && (
          <button
            type="button"
            className="border-0 bg-transparent p-0 text-[11px] text-faint hover:text-primary"
            onClick={() => onOpenDiff(session.id)}
          >
            Diff
          </button>
        )}
        {isStoppable(session.status) && (
          <button
            type="button"
            className="border-0 bg-transparent p-0 text-[11px] text-faint hover:text-danger"
            onClick={() => onStop(session.id)}
          >
            Stop
          </button>
        )}
        {canRequestMerge(session) && (
          <button
            type="button"
            className="border-0 bg-transparent p-0 text-[11px] text-faint hover:text-accent"
            onClick={() => onRequestMerge(session.id)}
          >
            Request merge
          </button>
        )}
        {canDiscardWorktree(session) && (
          <button
            type="button"
            className="border-0 bg-transparent p-0 text-[11px] text-faint hover:text-danger"
            onClick={() => onDiscardWorktree(session.id)}
          >
            Discard
          </button>
        )}
        {session.worktreeRemoved && <span className="text-[11px] text-faint">Worktree removed</span>}
      </div>
    </div>
  )
}
