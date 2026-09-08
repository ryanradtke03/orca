import { useState } from 'react'
import { Dashboard } from './components/dashboard/Dashboard'
import { DiffScreen } from './components/diff/DiffScreen'
import { SessionScreen } from './components/session/SessionScreen'
import { describeError } from './describe-error'
import { useSessionPoll } from './hooks/useSessionPoll'
import { isMockMode } from './mock'
import { MockDevToolbar } from './mock/MockDevToolbar'

type View = { type: 'dashboard' } | { type: 'diff'; sessionId: string } | { type: 'session'; sessionId: string }

export function App(): React.JSX.Element {
  const { projects, sessions, refreshAll, loadError } = useSessionPoll()
  const [view, setView] = useState<View>({ type: 'dashboard' })
  const [statusMessage, setStatusMessage] = useState('')

  const openSession = (sessionId: string): void => setView({ type: 'session', sessionId })
  const openDiff = (sessionId: string): void => setView({ type: 'diff', sessionId })
  const backToDashboard = (): void => setView({ type: 'dashboard' })

  async function handleAddProject(): Promise<void> {
    try {
      const project = await window.orca.addProjectViaDialog()
      if (!project) return
      await refreshAll()
      setStatusMessage('')
    } catch (error) {
      setStatusMessage(`Failed to add project: ${describeError(error)}`)
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
      />
    )
  }

  return (
    <>
      {content}
      {/* Dev-only Home populated/empty toggle - mock mode only (ticket #49). */}
      {isMockMode() && <MockDevToolbar onToggle={() => void refreshAll()} />}
    </>
  )
}
