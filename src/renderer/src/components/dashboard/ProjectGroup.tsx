import { shortMergeMode, type HomeSession, type ProjectSessionGroup } from '../../session-view'
import { SessionRow } from './SessionRow'

export function ProjectGroup({
  group,
  onOpenSession,
  onOpenDiff
}: {
  group: ProjectSessionGroup
  onOpenSession: (sessionId: string) => void
  onOpenDiff: (sessionId: string) => void
}): React.JSX.Element {
  return (
    <>
      <div id={`project-group-${group.project.id}`} className="flex items-center gap-2.5 px-6 pt-[22px] pb-1.5">
        <span className="text-[12.5px] font-medium text-primary">{group.project.name}</span>
        <span className="font-mono text-[10.5px] text-faint">{group.project.path}</span>
        <div className="h-px flex-1 bg-white/10" />
        <span className="flex-none font-mono text-[10.5px] text-faint">merge: {shortMergeMode(group.project.mergeMode)}</span>
      </div>

      <div className="mt-2 border-t border-border-faint">
        {group.sessions.length === 0 ? (
          <div className="px-6 py-3.5 text-[11.5px] text-faint">No sessions yet</div>
        ) : (
          group.sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session as HomeSession}
              projectName={group.project.name}
              onOpen={onOpenSession}
              onOpenDiff={onOpenDiff}
            />
          ))
        )}
      </div>
    </>
  )
}
