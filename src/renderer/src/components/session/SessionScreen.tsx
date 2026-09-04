import { useEffect, useRef, useState } from 'react'
import type { FileDiff, Session, TranscriptMessage } from '../../../../shared/ipc-contract'
import { describeError } from '../../describe-error'
import { canDiscardWorktree, canRequestMerge, describeStatus, isStoppable } from '../../session-view'
import { ChatPane } from './ChatPane'
import { Inspector } from './Inspector'

const TRANSCRIPT_POLL_INTERVAL_MS = 2000

function BackButton({ onBack }: { onBack: () => void }): React.JSX.Element {
  return (
    <button type="button" className="btn-ghost" onClick={onBack}>
      ← Back to sessions
    </button>
  )
}

function HeaderActions({
  session,
  onStop,
  onRequestMerge,
  onDiscardWorktree
}: {
  session: Session
  onStop: () => void
  onRequestMerge: () => void
  onDiscardWorktree: () => void
}): React.JSX.Element {
  return (
    <div className="flex gap-2">
      {isStoppable(session.status) && (
        <button type="button" className="btn-ghost px-[15px] py-2 text-[11.5px]" onClick={onStop}>
          Stop
        </button>
      )}
      {canRequestMerge(session) && (
        <button type="button" className="btn px-[15px] py-2 text-[11.5px]" onClick={onRequestMerge}>
          Request merge
        </button>
      )}
      {canDiscardWorktree(session) && (
        <button type="button" className="btn-ghost px-[15px] py-2 text-[11.5px]" onClick={onDiscardWorktree}>
          Discard
        </button>
      )}
    </div>
  )
}

export function SessionScreen({
  sessionId,
  sessions,
  onBack,
  onStop,
  onRespond,
  onRequestMerge,
  onDiscardWorktree
}: {
  sessionId: string
  sessions: Session[]
  onBack: () => void
  onStop: (sessionId: string) => void
  onRespond: (sessionId: string, response: string) => Promise<void>
  onRequestMerge: (sessionId: string) => void
  onDiscardWorktree: (sessionId: string) => void
}): React.JSX.Element {
  const session = sessions.find((candidate) => candidate.id === sessionId)

  const [files, setFiles] = useState<FileDiff[] | null>(null)
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  // Loads once per sessionId - re-fetching a `git diff` on every 2s status
  // poll tick would be wasteful, so this only reacts to navigating to a
  // (possibly different) session, not to `sessions` changing underneath it.
  useEffect(() => {
    let cancelled = false
    setFiles(null)
    setTranscript([])
    setLoadError(null)

    Promise.all([window.orca.getDiff(sessionId), window.orca.getTranscript(sessionId)])
      .then(([nextFiles, nextTranscript]) => {
        if (cancelled) return
        setFiles(nextFiles)
        setTranscript(nextTranscript)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(describeError(error))
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  // The transcript live-updates on a 2s cadence independent of the diff
  // (#45) - `inFlight` guards against a fetch slower than the interval
  // overlapping with the next tick's, and `cancelled` drops a response that
  // resolves after the user has navigated away from (or to a different)
  // session. A transient poll failure only logs - it doesn't touch
  // `loadError`, which is reserved for the initial load, so one flaky tick
  // doesn't blank an otherwise-working session view.
  const inFlight = useRef(false)
  useEffect(() => {
    if (files === null) return
    let cancelled = false

    const interval = setInterval(() => {
      if (inFlight.current) return
      inFlight.current = true
      window.orca
        .getTranscript(sessionId)
        .then((nextTranscript) => {
          if (!cancelled) setTranscript(nextTranscript)
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
    return (
      <div id="session-screen" className="flex h-screen w-full">
        <main id="session-main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="flex items-center gap-4 border-b border-border-soft px-6 py-4">
            <BackButton onBack={onBack} />
          </div>
          <div className="py-10 text-[12.5px] leading-relaxed text-faint">Failed to load session: Unknown session: {sessionId}</div>
        </main>
      </div>
    )
  }

  if (loadError) {
    return (
      <div id="session-screen" className="flex h-screen w-full">
        <main id="session-main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="flex items-center gap-4 border-b border-border-soft px-6 py-4">
            <BackButton onBack={onBack} />
          </div>
          <div className="py-10 text-[12.5px] leading-relaxed text-faint">Failed to load session: {loadError}</div>
        </main>
      </div>
    )
  }

  if (files === null) {
    return (
      <div id="session-screen" className="flex h-screen w-full">
        <main id="session-main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="py-10 text-[12.5px] leading-relaxed text-faint">Loading session…</div>
        </main>
      </div>
    )
  }

  return (
    <div id="session-screen" className="flex h-screen w-full">
      <main id="session-main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex items-center gap-4 border-b border-border-soft px-6 py-4">
          <BackButton onBack={onBack} />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[14px] leading-[1.1] text-primary">{session.branch}</div>
            <div className="mt-1.5 text-[9.5px] leading-none font-medium tracking-[0.09em] text-faint uppercase">
              {describeStatus(session.status)}
            </div>
          </div>
          <HeaderActions
            session={session}
            onStop={() => onStop(session.id)}
            onRequestMerge={() => onRequestMerge(session.id)}
            onDiscardWorktree={() => onDiscardWorktree(session.id)}
          />
        </div>
        <ChatPane session={session} transcript={transcript} onRespond={(response) => onRespond(session.id, response)} />
      </main>
      <Inspector session={session} files={files} />
    </div>
  )
}
