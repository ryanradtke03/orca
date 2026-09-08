import { useState } from 'react'
import { orca } from './api/orca-client'
import { Dashboard } from './views/dashboard/Dashboard'
import { DiffScreen } from './views/diff/DiffScreen'
import { SessionScreen } from './views/session/SessionScreen'
import { describeError } from './describe-error'
import { useSessionPoll } from './hooks/useSessionPoll'
import { isMockMode } from './mock'
import { MockDevToolbar } from './mock/MockDevToolbar'
import { ModeBadge } from './components/ModeBadge'

type View = { type: 'dashboard' } | { type: 'diff'; sessionId: string } | { type: 'session'; sessionId: string }

export function App(): React.JSX.Element {
  const { projects, sessions, refreshAll, applySession, loadError } = useSessionPoll()
  const [view, setView] = useState<View>({ type: 'dashboard' })
  const [statusMessage, setStatusMessage] = useState('')

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

  let content: React.JSX.Element
  if (view.type === 'diff') {
    content = (
      <DiffScreen sessionId={view.sessionId} sessions={sessions} projects={projects} onBack={backToDashboard} />
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
      />
    )
  }

  return (
    <>
      {content}
      <ModeBadge />
      {/* Dev-only Home populated/empty toggle - mock mode only (ticket #49). */}
      {isMockMode() && <MockDevToolbar onToggle={() => void refreshAll()} />}
    </>
  )
}
