import type { Project, Session } from '../../../../shared/ipc-contract'
import { groupSessionsByProject, needsAttentionSessions, type HomeSession } from '../../view-models/session'
import { EmptyState } from './EmptyState'
import { MainPane } from './MainPane'
import { Sidebar } from './Sidebar'

export function Dashboard({
  projects,
  sessions,
  statusMessage,
  onAddProject,
  onOpenSession,
  onOpenDiff,
  onStopSession,
  onNewSession,
  onRespondToPrompt,
  onOpenAdopt,
  onRequestRemove
}: {
  projects: Project[]
  sessions: Session[]
  statusMessage: string
  onAddProject: () => Promise<void>
  onOpenSession: (sessionId: string) => void
  onOpenDiff: (sessionId: string) => void
  onStopSession: (sessionId: string) => void
  onNewSession: (projectId: string) => void
  onRespondToPrompt: (sessionId: string, response: string) => void
  onOpenAdopt: () => void
  onRequestRemove: (sessionId: string) => void
}): React.JSX.Element {
  const groups = groupSessionsByProject(projects, sessions)
  const attention = needsAttentionSessions(sessions)
  const projectNames = new Map(projects.map((project) => [project.id, project.name]))
  const projectNameFor = (projectId: string): string => projectNames.get(projectId) ?? projectId

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        projects={projects}
        sessions={sessions}
        groups={groups}
        attention={attention}
        statusMessage={statusMessage}
        onAddProject={() => void onAddProject()}
      />
      {projects.length === 0 ? (
        <EmptyState onAddProject={() => void onAddProject()} onAdoptSession={onOpenAdopt} />
      ) : (
        <MainPane
          sessions={sessions}
          groups={groups}
          attention={attention as HomeSession[]}
          projectNameFor={projectNameFor}
          onOpenSession={onOpenSession}
          onOpenDiff={onOpenDiff}
          onStopSession={onStopSession}
          onNewSession={onNewSession}
          onRespondToPrompt={onRespondToPrompt}
          onOpenAdopt={onOpenAdopt}
          onRequestRemove={onRequestRemove}
        />
      )}
    </div>
  )
}
