import type { MergeMode, Project, Session } from '../../../../shared/ipc-contract'
import { groupSessionsByProject, needsAttentionSessions } from '../../session-view'
import { EmptyState } from './EmptyState'
import { MainPane } from './MainPane'
import { Sidebar } from './Sidebar'

export function Dashboard({
  projects,
  sessions,
  statusMessage,
  onAddProject,
  onNewSession,
  onSetProjectMergeMode,
  onAdoptSession,
  onOpenSession,
  onOpenDiff,
  onStop,
  onRequestMerge,
  onDiscardWorktree
}: {
  projects: Project[]
  sessions: Session[]
  statusMessage: string
  onAddProject: () => Promise<void>
  onNewSession: (projectId: string) => Promise<void>
  onSetProjectMergeMode: (projectId: string, mergeMode: MergeMode) => Promise<void>
  onAdoptSession: (pid: number, directory: string) => Promise<void>
  onOpenSession: (sessionId: string) => void
  onOpenDiff: (sessionId: string) => void
  onStop: (sessionId: string) => Promise<void>
  onRequestMerge: (sessionId: string) => Promise<void>
  onDiscardWorktree: (sessionId: string) => Promise<void>
}): React.JSX.Element {
  const groups = groupSessionsByProject(projects, sessions)
  const attention = needsAttentionSessions(sessions)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        projects={projects}
        sessions={sessions}
        groups={groups}
        attention={attention}
        statusMessage={statusMessage}
        onAddProject={() => void onAddProject()}
        onAdoptSession={onAdoptSession}
      />
      {projects.length === 0 ? (
        <EmptyState onAddProject={() => void onAddProject()} />
      ) : (
        <MainPane
          sessions={sessions}
          groups={groups}
          attention={attention}
          onOpenSession={onOpenSession}
          onOpenDiff={onOpenDiff}
          onNewSession={(projectId) => void onNewSession(projectId)}
          onSetProjectMergeMode={(projectId, mergeMode) => void onSetProjectMergeMode(projectId, mergeMode)}
          onStop={(sessionId) => void onStop(sessionId)}
          onRequestMerge={(sessionId) => void onRequestMerge(sessionId)}
          onDiscardWorktree={(sessionId) => void onDiscardWorktree(sessionId)}
        />
      )}
    </div>
  )
}
