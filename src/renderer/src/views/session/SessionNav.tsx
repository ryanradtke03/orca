import { bucketSessionsForNav, describeNavDetail, type DetailSession } from '../../view-models/session'
import { StatusMarker } from '../../components/StatusMarker'

function NavRow({
  session,
  detail,
  selected,
  onOpen
}: {
  session: DetailSession
  detail: string
  selected: boolean
  onOpen: (sessionId: string) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${
        selected ? 'bg-active' : 'hover:bg-hover'
      }`}
      onClick={() => onOpen(session.id)}
    >
      <span className="w-[11px] flex-none text-center text-[11px] text-primary">
        <StatusMarker status={session.status} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12px] text-primary">{session.branch}</span>
        <span className="mt-1 block truncate font-mono text-[10.5px] text-faint">{detail}</span>
      </span>
    </button>
  )
}

function NavSection({
  label,
  count,
  sessions,
  currentProjectId,
  currentSessionId,
  projectNameFor,
  onOpen
}: {
  label: string
  count?: number
  sessions: DetailSession[]
  currentProjectId: string
  currentSessionId: string
  projectNameFor: (projectId: string) => string
  onOpen: (sessionId: string) => void
}): React.JSX.Element | null {
  if (sessions.length === 0) return null
  return (
    <div className="mb-4">
      <div className="label-heading px-2.5 pb-2">{count === undefined ? label : `${label} · ${count}`}</div>
      <div className="flex flex-col gap-px">
        {sessions.map((session) => (
          <NavRow
            key={session.id}
            session={session}
            detail={describeNavDetail(session, currentProjectId, projectNameFor(session.projectId))}
            selected={session.id === currentSessionId}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  )
}

export function SessionNav({
  sessions,
  currentProjectId,
  currentProjectName,
  currentSessionId,
  projectNameFor,
  onOpenSession
}: {
  sessions: DetailSession[]
  currentProjectId: string
  currentProjectName: string
  currentSessionId: string
  projectNameFor: (projectId: string) => string
  onOpenSession: (sessionId: string) => void
}): React.JSX.Element {
  const { needsYou, active, recent } = bucketSessionsForNav(sessions, currentProjectId)
  const projectSessionCount = sessions.filter((session) => session.projectId === currentProjectId).length

  return (
    <aside className="flex w-[236px] flex-none flex-col border-r border-border-soft bg-sidebar">
      <div className="flex items-start justify-between px-4 pt-5 pb-4">
        <div className="min-w-0">
          <div className="text-[15px] leading-none font-semibold tracking-[-0.01em] text-primary">Orca</div>
          <div className="mt-[6px] truncate font-mono text-[10.5px] leading-none text-tertiary">
            {currentProjectName} · {projectSessionCount} sessions
          </div>
        </div>
        {/* New-session affordance - inert for now (ticket #51). */}
        <button
          type="button"
          className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-md border border-dashed border-white/28 text-[13px] leading-none text-faint hover:border-white/70 hover:text-primary"
          aria-label="New session"
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pt-1">
        <NavSection
          label="Needs you"
          count={needsYou.length}
          sessions={needsYou}
          currentProjectId={currentProjectId}
          currentSessionId={currentSessionId}
          projectNameFor={projectNameFor}
          onOpen={onOpenSession}
        />
        <NavSection
          label="Active"
          sessions={active}
          currentProjectId={currentProjectId}
          currentSessionId={currentSessionId}
          projectNameFor={projectNameFor}
          onOpen={onOpenSession}
        />
        <NavSection
          label="Recent"
          sessions={recent}
          currentProjectId={currentProjectId}
          currentSessionId={currentSessionId}
          projectNameFor={projectNameFor}
          onOpen={onOpenSession}
        />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border-faint px-4 py-3.5 font-mono text-[10px] text-faint">
        <span>⌘K · jump to session</span>
        <span>⌘⏎ · send prompt</span>
      </div>
    </aside>
  )
}
