import type { Session } from '../../../../shared/ipc-contract'
import { summarizeStatuses, type HomeSession, type ProjectSessionGroup } from '../../view-models/session'
import { NeedsYouSection } from './NeedsYouSection'
import { ProjectGroup } from './ProjectGroup'

export function MainPane({
  sessions,
  groups,
  attention,
  projectNameFor,
  onOpenSession,
  onOpenDiff
}: {
  sessions: Session[]
  groups: ProjectSessionGroup[]
  attention: HomeSession[]
  projectNameFor: (projectId: string) => string
  onOpenSession: (sessionId: string) => void
  onOpenDiff: (sessionId: string) => void
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
        {/* Header actions are still visual-only no-ops - wiring New session /
            Adopt session to real IPC is deferred (ticket #50). */}
        <div className="flex flex-none items-center gap-2.5">
          <button type="button" className="btn-ghost">
            Adopt session
          </button>
          <button type="button" className="btn">
            New session
          </button>
        </div>
      </div>

      <NeedsYouSection attention={attention} projectNameFor={projectNameFor} onOpen={onOpenSession} />

      <div className="pb-6">
        {groups.map((group) => (
          <ProjectGroup key={group.project.id} group={group} onOpenSession={onOpenSession} onOpenDiff={onOpenDiff} />
        ))}
      </div>
    </main>
  )
}
