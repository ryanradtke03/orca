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
  onOpenDiff,
  onStopSession,
  onNewSession,
  onRespondToPrompt,
  onOpenAdopt,
  onRequestRemove
}: {
  sessions: Session[]
  groups: ProjectSessionGroup[]
  attention: HomeSession[]
  projectNameFor: (projectId: string) => string
  onOpenSession: (sessionId: string) => void
  onOpenDiff: (sessionId: string) => void
  onStopSession: (sessionId: string) => void
  onNewSession: (projectId: string) => void
  onRespondToPrompt: (sessionId: string, response: string) => void
  onOpenAdopt: () => void
  onRequestRemove: (sessionId: string) => void
}): React.JSX.Element {
  const stats = summarizeStatuses(sessions)
  // The global "New session" spawns into the first project - MainPane only
  // renders when at least one project exists (Dashboard shows EmptyState
  // otherwise), so this is always defined.
  const firstProjectId = groups[0]?.project.id

  return (
    <main id="main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border-soft px-6 pt-[18px] pb-4">
        <div>
          <h1 className="m-0 text-[18px] leading-[1.1] font-semibold tracking-[-0.015em] text-primary">
            All sessions
          </h1>
          <div className="mt-[5px] font-mono text-[11px] text-tertiary">{stats || 'No sessions yet'}</div>
        </div>
        {/* Adopt session opens a form for pid + directory (#58); New session
            spawns a bare idle session (#57). */}
        <div className="flex flex-none items-center gap-2.5">
          <button type="button" className="btn-ghost" onClick={onOpenAdopt}>
            Adopt session
          </button>
          <button
            type="button"
            className="btn"
            disabled={firstProjectId === undefined}
            onClick={() => firstProjectId !== undefined && onNewSession(firstProjectId)}
          >
            New session
          </button>
        </div>
      </div>

      <NeedsYouSection
        attention={attention}
        projectNameFor={projectNameFor}
        onOpen={onOpenSession}
        onRespond={onRespondToPrompt}
      />

      <div className="pb-6">
        {groups.map((group) => (
          <ProjectGroup
            key={group.project.id}
            group={group}
            onOpenSession={onOpenSession}
            onOpenDiff={onOpenDiff}
            onStopSession={onStopSession}
            onRequestRemove={onRequestRemove}
          />
        ))}
      </div>
    </main>
  )
}
