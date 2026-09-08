import { useEffect, useRef, useState } from 'react'
import type { FileDiff, Project, Session, TranscriptMessage } from '../../../../shared/ipc-contract'
import { describeError } from '../../describe-error'
import { canViewDiff, describeStatusPhrase, type DetailSession } from '../../session-view'
import { messagesToEntries, type TranscriptEntry } from '../../transcript-view'
import { ChatPane } from './ChatPane'
import { Composer } from './Composer'
import { Inspector } from './Inspector'
import { SessionNav } from './SessionNav'

const TRANSCRIPT_POLL_INTERVAL_MS = 2000

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

  const [files, setFiles] = useState<FileDiff[] | null>(null)
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  // Loads once per sessionId - re-fetching a `git diff` on every 2s status
  // poll tick would be wasteful, so this only reacts to navigating to a
  // (possibly different) session, not to `sessions` changing underneath it.
  useEffect(() => {
    let cancelled = false
    setFiles(null)
    setMessages([])
    setLoadError(null)

    Promise.all([window.orca.getDiff(sessionId), window.orca.getTranscript(sessionId)])
      .then(([nextFiles, nextMessages]) => {
        if (cancelled) return
        setFiles(nextFiles)
        setMessages(nextMessages)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(describeError(error))
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  // The plain transcript live-updates on a 2s cadence independent of the diff
  // (#45). It's the live-mode fallback: in mock mode the richer transcript
  // (tool calls + permission card) rides along on the session itself and is
  // preferred below. `inFlight` guards a slow fetch overlapping the next tick;
  // `cancelled` drops a response that resolves after navigating away. A
  // transient poll failure only logs - it doesn't touch `loadError`, which is
  // reserved for the initial load.
  const inFlight = useRef(false)
  useEffect(() => {
    if (files === null) return
    let cancelled = false

    const interval = setInterval(() => {
      if (inFlight.current) return
      inFlight.current = true
      window.orca
        .getTranscript(sessionId)
        .then((nextMessages) => {
          if (!cancelled) setMessages(nextMessages)
        })
        .catch((error: unknown) => {
          if (!cancelled) console.error(`Failed to refresh transcript for ${sessionId}:`, error)
        })
        .finally(() => {
          inFlight.current = false
        })
    }, TRANSCRIPT_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [sessionId, files])

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
