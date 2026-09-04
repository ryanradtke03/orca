import type { MergeMode, Session } from '../../../../shared/ipc-contract'
import { summarizeStatuses, type ProjectSessionGroup } from '../../session-view'
import { NeedsYouSection } from './NeedsYouSection'
import { ProjectGroup } from './ProjectGroup'

export function MainPane({
  sessions,
  groups,
  attention,
  onOpenSession,
  onOpenDiff,
  onNewSession,
  onSetProjectMergeMode,
  onStop,
  onRequestMerge,
  onDiscardWorktree
}: {
  sessions: Session[]
  groups: ProjectSessionGroup[]
  attention: Session[]
  onOpenSession: (sessionId: string) => void
  onOpenDiff: (sessionId: string) => void
  onNewSession: (projectId: string) => void
  onSetProjectMergeMode: (projectId: string, mergeMode: MergeMode) => void
  onStop: (sessionId: string) => void
  onRequestMerge: (sessionId: string) => void
  onDiscardWorktree: (sessionId: string) => void
}): React.JSX.Element {
  const stats = summarizeStatuses(sessions)

  return (
    <main id="main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border-soft px-6 pt-[18px] pb-4">
        <div>
          <h1 className="m-0 text-[18px] leading-[1.1] font-semibold tracking-[-0.015em] text-primary">
            All sessions
          </h1>
          <div className="mt-[5px] font-mono text-[11px] text-tertiary">{stats || 'No sessions yet'}</div>
        </div>
      </div>

      <NeedsYouSection attention={attention} onOpen={onOpenSession} />

      <div className="pb-6">
        {groups.map((group) => (
          <ProjectGroup
            key={group.project.id}
            group={group}
            onSetProjectMergeMode={onSetProjectMergeMode}
            onNewSession={onNewSession}
            onOpenSession={onOpenSession}
            onOpenDiff={onOpenDiff}
            onStop={onStop}
            onRequestMerge={onRequestMerge}
            onDiscardWorktree={onDiscardWorktree}
          />
        ))}
      </div>
    </main>
  )
}
