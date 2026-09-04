import type { MergeMode } from '../../../../shared/ipc-contract'
import { describeMergeMode, MERGE_MODES, type ProjectSessionGroup } from '../../session-view'
import { SessionRow } from './SessionRow'

export function ProjectGroup({
  group,
  onSetProjectMergeMode,
  onNewSession,
  onOpenSession,
  onOpenDiff,
  onStop,
  onRequestMerge,
  onDiscardWorktree
}: {
  group: ProjectSessionGroup
  onSetProjectMergeMode: (projectId: string, mergeMode: MergeMode) => void
  onNewSession: (projectId: string) => void
  onOpenSession: (sessionId: string) => void
  onOpenDiff: (sessionId: string) => void
  onStop: (sessionId: string) => void
  onRequestMerge: (sessionId: string) => void
  onDiscardWorktree: (sessionId: string) => void
}): React.JSX.Element {
  return (
    <>
      <div id={`project-group-${group.project.id}`} className="flex items-center gap-2.5 px-6 pt-[22px] pb-1.5">
        <span className="text-[12.5px] font-medium text-primary">{group.project.name}</span>
        <span className="font-mono text-[10.5px] text-faint">{group.project.path}</span>
        <div className="h-px flex-1 bg-white/10" />
        <select
          className="flex-none rounded-[5px] border border-border-medium bg-white/4 px-2 py-1 text-[10.5px] text-secondary hover:text-primary"
          value={group.project.mergeMode}
          onChange={(event) => onSetProjectMergeMode(group.project.id, event.target.value as MergeMode)}
        >
          {MERGE_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {describeMergeMode(mode)}
            </option>
          ))}
        </select>
        <form
          className="flex flex-none items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            onNewSession(group.project.id)
          }}
        >
          <button type="submit" className="btn px-[11px] py-[5px] text-[10.5px]">
            New session
          </button>
        </form>
      </div>

      <div className="mt-2 border-t border-border-faint">
        {group.sessions.length === 0 ? (
          <div className="px-6 py-3.5 text-[11.5px] text-faint">No sessions yet</div>
        ) : (
          group.sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onOpen={onOpenSession}
              onOpenDiff={onOpenDiff}
              onStop={onStop}
              onRequestMerge={onRequestMerge}
              onDiscardWorktree={onDiscardWorktree}
            />
          ))
        )}
      </div>
    </>
  )
}
