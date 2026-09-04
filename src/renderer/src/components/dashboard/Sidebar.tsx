import type { Project, Session } from '../../../../shared/ipc-contract'
import type { ProjectSessionGroup } from '../../session-view'
import { AdoptForm } from './AdoptForm'

function scrollToId(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function Sidebar({
  projects,
  sessions,
  groups,
  attention,
  statusMessage,
  onAddProject,
  onAdoptSession
}: {
  projects: Project[]
  sessions: Session[]
  groups: ProjectSessionGroup[]
  attention: Session[]
  statusMessage: string
  onAddProject: () => void
  onAdoptSession: (pid: number, directory: string) => Promise<void>
}): React.JSX.Element {
  const subtitle = projects.length === 0 ? 'no projects' : `${sessions.length} sessions · ${projects.length} projects`

  return (
    <aside className="flex w-[220px] flex-none flex-col border-r border-border-soft bg-sidebar">
      <div className="px-[18px] pt-5 pb-3.5">
        <div className="text-[15px] leading-none font-semibold tracking-[-0.01em] text-primary">Orca</div>
        <div className="mt-[5px] font-mono text-[10.5px] leading-none text-tertiary">{subtitle}</div>
      </div>

      {attention.length > 0 && (
        <button
          type="button"
          className="mx-3 mb-3.5 flex items-center justify-between rounded-[7px] border border-border-strong px-3 py-2.5 text-left hover:bg-hover"
          onClick={() => scrollToId('needs-you-section')}
        >
          <span className="text-[11.5px] font-medium text-primary">Needs you</span>
          <span className="h-[18px] min-w-[18px] rounded-full bg-accent px-[5px] text-center font-mono text-[10.5px] leading-[18px] font-semibold text-accent-ink">
            {attention.length}
          </span>
        </button>
      )}

      <div id="project-nav" className="flex flex-col gap-px overflow-y-auto px-3">
        <div className="label-heading px-1.5 py-1.5">Projects</div>
        {groups.map((group) => (
          <button
            key={group.project.id}
            type="button"
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-hover"
            onClick={() => scrollToId(`project-group-${group.project.id}`)}
          >
            <span className="text-[12.5px] text-secondary">{group.project.name}</span>
            <span className="font-mono text-[10.5px] text-tertiary">{group.sessions.length}</span>
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <div className="border-t border-border-faint px-3 py-3.5">
        <button
          type="button"
          className="w-full rounded-md border border-dashed border-white/28 px-3 py-2 text-center text-[11.5px] text-secondary hover:border-white/70 hover:text-primary"
          onClick={onAddProject}
        >
          + Add project
        </button>
        <AdoptForm onAdopt={onAdoptSession} />
      </div>

      {statusMessage && (
        <p role="alert" className="m-0 px-3.5 py-2.5 text-[11px] leading-snug text-danger">
          {statusMessage}
        </p>
      )}
    </aside>
  )
}
