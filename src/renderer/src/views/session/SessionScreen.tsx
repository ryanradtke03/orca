import type { Project, Session } from '../../../../shared/ipc-contract'
import { useDiff } from '../../hooks/useDiff'
import { useTranscript } from '../../hooks/useTranscript'
import { canViewDiff, describeStatusPhrase, type DetailSession } from '../../view-models/session'
import { messagesToEntries, type TranscriptEntry } from '../../view-models/transcript'
import { ChatPane } from './ChatPane'
import { Composer } from './Composer'
import { Inspector } from './Inspector'
import { SessionNav } from './SessionNav'

function BackButton({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <button type="button" className="btn-ghost" onClick={onBack}>
      ← Back to sessions
    </button>
  )
}

function SessionHeader({
  session,
  projectName,
  onBack,
  onViewDiff
}: {
  session: DetailSession
  projectName: string
  onBack: () => void
  onViewDiff: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 border-b border-border-soft px-6 py-4">
      <BackButton onBack={onBack} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="h-[7px] w-[7px] flex-none rotate-45 bg-accent" />
          <span className="truncate font-mono text-[14px] leading-none text-primary">
            {projectName}/{session.branch}
          </span>
        </div>
        <div className="mt-2 truncate font-mono text-[10.5px] leading-none text-faint">
          {describeStatusPhrase(session.status)} · branch {session.branch} · base @ {session.baseRef}
        </div>
      </div>
      {canViewDiff(session) && (
        <button type="button" className="btn-ghost px-[15px] py-2 text-[11.5px]" onClick={onViewDiff}>
          View diff
        </button>
      )}
      {/* Stop is inert for now (ticket #51) - wiring session actions is a later ticket. */}
      <button type="button" className="btn px-[15px] py-2 text-[11.5px]">
        Stop
      </button>
    </div>
  )
}

/** A minimal frame for the not-found / loading / error states, so they still carry a way back. */
function SessionShell({ onBack, children }: { onBack: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <div id="session-screen" className="flex h-screen w-full">
      <main id="session-main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex items-center gap-4 border-b border-border-soft px-6 py-4">
          <BackButton onBack={onBack} />
        </div>
        <div className="py-10 pl-6 text-[12.5px] leading-relaxed text-faint">{children}</div>
      </main>
    </div>
  )
}

export function SessionScreen({
  sessionId,
  sessions,
  projects,
  onBack,
  onOpenSession,
  onOpenDiff
}: {
  sessionId: string
  sessions: Session[]
  projects: Project[]
  onBack: () => void
  onOpenSession: (sessionId: string) => void
  onOpenDiff: (sessionId: string) => void
}): React.JSX.Element {
  const session = sessions.find((candidate) => candidate.id === sessionId) as DetailSession | undefined

  // The diff feeds the inspector; the transcript live-updates on a 2s cadence.
  // Both load once per sessionId (not on every status-poll tick). Either
  // initial-load failure errors the whole screen.
  const { files, loadError: diffError } = useDiff(sessionId)
  const { messages, loadError: transcriptError } = useTranscript(sessionId)
  const loadError = diffError ?? transcriptError

  if (!session) {
    return <SessionShell onBack={onBack}>Failed to load session: Unknown session: {sessionId}</SessionShell>
  }
  if (loadError) {
    return <SessionShell onBack={onBack}>Failed to load session: {loadError}</SessionShell>
  }
  if (files === null) {
    return <SessionShell onBack={onBack}>Loading session…</SessionShell>
  }

  const project = projects.find((candidate) => candidate.id === session.projectId)
  const projectName = project?.name ?? session.projectId
  const projectNameFor = (projectId: string): string =>
    projects.find((candidate) => candidate.id === projectId)?.name ?? projectId

  // Prefer the rich transcript that rode along on the session (mock mode); fall
  // back to the plain polled messages (live mode).
  const entries: TranscriptEntry[] = session.transcript ?? messagesToEntries(messages)

  return (
    <div id="session-screen" className="flex h-screen w-full">
      <SessionNav
        sessions={sessions as DetailSession[]}
        currentProjectId={session.projectId}
        currentProjectName={projectName}
        currentSessionId={session.id}
        projectNameFor={projectNameFor}
        onOpenSession={onOpenSession}
      />
      <main id="session-main" className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <SessionHeader
          session={session}
          projectName={projectName}
          onBack={onBack}
          onViewDiff={() => onOpenDiff(session.id)}
        />
        <ChatPane entries={entries} />
        <Composer queuedCount={session.queuedPrompts?.length ?? 0} />
      </main>
      <Inspector session={session} files={files} mergeMode={project?.mergeMode} />
    </div>
  )
}
