import { StatusMarker } from '../../components/StatusMarker'
import {
  contextualActionFor,
  describeStatus,
  formatDiffStat,
  isAttentionStatus,
  isTerminalStatus,
  type HomeSession
} from '../../view-models/session'

export function SessionRow({
  session,
  projectName,
  onOpen,
  onOpenDiff,
  onStop
}: {
  session: HomeSession
  projectName: string
  onOpen: (sessionId: string) => void
  onOpenDiff: (sessionId: string) => void
  onStop: (sessionId: string) => void
}): React.JSX.Element {
  const branchClass = isTerminalStatus(session.status) ? 'text-secondary' : 'text-primary'
  const diffStat = formatDiffStat(session)
  const action = contextualActionFor(session)

  // The single contextual action either navigates (Review → the diff, Log →
  // the session view) or stops the session (Stop → engine mutation). Either way
  // it must not also trigger the row's own navigation, hence stopPropagation.
  function runAction(event: React.MouseEvent): void {
    event.stopPropagation()
    if (action.kind === 'review') onOpenDiff(session.id)
    else if (action.kind === 'log') onOpen(session.id)
    else onStop(session.id)
  }

  return (
    <div
      className="flex cursor-pointer items-center gap-3.5 border-b border-border-faint px-6 py-2.5 last:border-b-0 hover:bg-hover"
      title={session.worktreePath}
      onClick={() => onOpen(session.id)}
    >
      <div className="w-[11px] flex-none text-center text-[11px] text-primary">
        <StatusMarker status={session.status} />
      </div>
      <div className={`min-w-0 flex-1 truncate font-mono text-xs ${branchClass}`}>
        {projectName}/{session.branch}
      </div>
      <div className="w-[168px] flex-none font-mono text-[11px] text-tertiary">{diffStat}</div>
      <div
        className={`w-[168px] flex-none text-[9.5px] leading-none font-medium tracking-[0.09em] uppercase ${
          isAttentionStatus(session.status) ? 'text-primary' : 'text-faint'
        }`}
      >
        {describeStatus(session.status)}
      </div>
      <button
        type="button"
        className="w-[52px] flex-none text-right text-[11px] text-faint hover:text-primary"
        onClick={runAction}
      >
        {action.label}
      </button>
    </div>
  )
}
