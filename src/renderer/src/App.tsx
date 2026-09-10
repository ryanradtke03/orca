import { useState } from 'react'
import { orca } from './api/orca-client'
import { Dashboard } from './views/dashboard/Dashboard'
import { DiffScreen } from './views/diff/DiffScreen'
import { SessionScreen } from './views/session/SessionScreen'
import { describeError } from './describe-error'
import { useSessionPoll } from './hooks/useSessionPoll'
import { useReviewState } from './hooks/useReviewState'
import { isMockMode } from './mock'
import { MockDevToolbar } from './mock/MockDevToolbar'
import { ModeBadge } from './components/ModeBadge'
import { AdoptSessionModal } from './components/AdoptSessionModal'
import { RemoveSessionModal } from './components/RemoveSessionModal'
import type { Session } from '../../shared/ipc-contract'

type View = { type: 'dashboard' } | { type: 'diff'; sessionId: string } | { type: 'session'; sessionId: string }

export function App(): React.JSX.Element {
  const { projects, sessions, refreshAll, applySession, dropSession, loadError } = useSessionPoll()
  const review = useReviewState()
  const [view, setView] = useState<View>({ type: 'dashboard' })
  const [statusMessage, setStatusMessage] = useState('')
  const [adoptOpen, setAdoptOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Session | null>(null)

  const openSession = (sessionId: string): void => setView({ type: 'session', sessionId })
  const openDiff = (sessionId: string): void => setView({ type: 'diff', sessionId })
  const backToDashboard = (): void => setView({ type: 'dashboard' })

  async function handleAddProject(): Promise<void> {
    try {
      const project = await orca.addProjectViaDialog()
      if (!project) return
      await refreshAll()
      setStatusMessage('')
    } catch (error) {
      setStatusMessage(`Failed to add project: ${describeError(error)}`)
    }
  }

  // Each mutation returns the updated Session, applied to local state at once
  // (the poll is only the safety net). On failure we never crash: surface the
  // message on the dashboard and always log it so it is visible in `dev`.
  async function handleStopSession(sessionId: string): Promise<void> {
    try {
      applySession(await orca.stopSession(sessionId))
      setStatusMessage('')
    } catch (error) {
      const message = `Failed to stop session: ${describeError(error)}`
      console.error(message, error)
      setStatusMessage(message)
    }
  }

  // Spawn creates a bare idle session (no task, #44); driving it to `done`
  // through the UI is #41's job. Here it just needs to appear as a new row.
  async function handleNewSession(projectId: string): Promise<void> {
    try {
      applySession(await orca.spawnSession(projectId))
      setStatusMessage('')
    } catch (error) {
      const message = `Failed to start session: ${describeError(error)}`
      console.error(message, error)
      setStatusMessage(message)
    }
  }

  // Answer a prompt (permission approve/deny, or a reply to a waiting/idle
  // session) and reflect the returned Session optimistically. respondToPrompt
  // *throws* for a `running` session - RESPONDABLE_STATUSES (engine.ts) excludes
  // it - so every caller must handle the rejection rather than assume success.
  // This raw form rethrows; the two surfaces below each surface it their own way.
  async function respondToPrompt(sessionId: string, response: string): Promise<void> {
    applySession(await orca.respondToPrompt(sessionId, response))
  }

  // Dashboard idiom (Group A): a failed "Needs you" approve/deny surfaces on the
  // status line and always logs; it never crashes the app.
  async function handleRespondFromDashboard(sessionId: string, response: string): Promise<void> {
    try {
      await respondToPrompt(sessionId, response)
      setStatusMessage('')
    } catch (error) {
      const message = `Failed to answer prompt: ${describeError(error)}`
      console.error(message, error)
      setStatusMessage(message)
    }
  }

  // Opens the confirm modal for a row's / the header's Remove action. The
  // actual removal only runs once RemoveSessionModal confirms (handleRemoveSession).
  function requestRemoveSession(sessionId: string): void {
    const session = sessions.find((candidate) => candidate.id === sessionId)
    if (session) setRemoveTarget(session)
  }

  // The confirmed removal: drop the session everywhere, and if it was the one
  // open on the session/diff screen there's nothing left to show, so fall back
  // to the dashboard. Rejections propagate to RemoveSessionModal, which keeps
  // the dialog open and surfaces the error inline (it never crashes the app).
  async function handleRemoveSession(sessionId: string): Promise<void> {
    await orca.removeSession(sessionId)
    dropSession(sessionId)
    setStatusMessage('')
    if (view.type !== 'dashboard' && view.sessionId === sessionId) backToDashboard()
  }

  // The happy path only: adopt the session and reflect it optimistically. The
  // AdoptSessionModal owns validation and inline error display, so failures
  // reject back to it (staying open) rather than being swallowed here.
  async function handleAdoptSession(pid: number, directory: string): Promise<void> {
    applySession(await orca.adoptSession(pid, directory))
    setStatusMessage('')
  }

  let content: React.JSX.Element
  if (view.type === 'diff') {
    content = (
      <DiffScreen
        sessionId={view.sessionId}
        sessions={sessions}
        projects={projects}
        reviewedPaths={review.reviewedPathsFor(view.sessionId)}
        onBack={backToDashboard}
        onToggleReviewed={review.toggleReviewed}
        onMarkReviewed={review.markReviewed}
      />
    )
  } else if (view.type === 'session') {
    content = (
      <SessionScreen
        sessionId={view.sessionId}
        sessions={sessions}
        projects={projects}
        onBack={backToDashboard}
        onOpenSession={openSession}
        onOpenDiff={openDiff}
        onStopSession={handleStopSession}
        onNewSession={handleNewSession}
        onRespondToPrompt={respondToPrompt}
        onRequestRemove={requestRemoveSession}
      />
    )
  } else {
    content = (
      <Dashboard
        projects={projects}
        sessions={sessions}
        statusMessage={statusMessage || loadError}
        onAddProject={handleAddProject}
        onOpenSession={openSession}
        onOpenDiff={openDiff}
        onStopSession={handleStopSession}
        onNewSession={handleNewSession}
        onRespondToPrompt={handleRespondFromDashboard}
        onOpenAdopt={() => setAdoptOpen(true)}
        onRequestRemove={requestRemoveSession}
      />
    )
  }

  return (
    <>
      {content}
      {adoptOpen && <AdoptSessionModal onAdopt={handleAdoptSession} onClose={() => setAdoptOpen(false)} />}
      {removeTarget && (
        <RemoveSessionModal
          session={removeTarget}
          projectName={projects.find((project) => project.id === removeTarget.projectId)?.name ?? removeTarget.projectId}
          onConfirm={handleRemoveSession}
          onClose={() => setRemoveTarget(null)}
        />
      )}
      <ModeBadge />
      {/* Dev-only Home populated/empty toggle - mock mode only (ticket #49). */}
      {isMockMode() && <MockDevToolbar onToggle={() => void refreshAll()} />}
    </>
  )
}
