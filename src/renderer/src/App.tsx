import { useState } from 'react'
import type { MergeMode } from '../../shared/ipc-contract'
import { Dashboard } from './components/dashboard/Dashboard'
import { DiffScreen } from './components/diff/DiffScreen'
import { SessionScreen } from './components/session/SessionScreen'
import { describeError } from './describe-error'
import { useSessionPoll } from './hooks/useSessionPoll'

type View = { type: 'dashboard' } | { type: 'diff'; sessionId: string } | { type: 'session'; sessionId: string }

export function App(): React.JSX.Element {
  const { projects, sessions, refreshAll, refreshSessions, loadError } = useSessionPoll()
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

  async function handleNewSession(projectId: string): Promise<void> {
    try {
      await window.orca.spawnSession(projectId)
      await refreshAll()
      setStatusMessage('')
    } catch (error) {
      setStatusMessage(`Failed to spawn session: ${describeError(error)}`)
    }
  }

  async function handleStopSession(sessionId: string): Promise<void> {
    try {
      await window.orca.stopSession(sessionId)
      await refreshSessions()
      setStatusMessage('')
    } catch (error) {
      setStatusMessage(`Failed to stop session: ${describeError(error)}`)
    }
  }

  // Rethrows on failure so a caller with its own local feedback (e.g.
  // ReplyForm, which shouldn't clear a message the send failed for) can
  // react to the outcome directly instead of only through `statusMessage`.
  async function handleRespondToPrompt(sessionId: string, response: string): Promise<void> {
    try {
      await window.orca.respondToPrompt(sessionId, response)
      await refreshSessions()
      setStatusMessage('')
    } catch (error) {
      setStatusMessage(`Failed to respond to prompt: ${describeError(error)}`)
      throw error
    }
  }

  async function handleSetProjectMergeMode(projectId: string, mergeMode: MergeMode): Promise<void> {
    try {
      await window.orca.setProjectMergeMode(projectId, mergeMode)
      await refreshAll()
      setStatusMessage('')
    } catch (error) {
      setStatusMessage(`Failed to set merge mode: ${describeError(error)}`)
    }
  }

  async function handleRequestMerge(sessionId: string): Promise<void> {
    try {
      const result = await window.orca.requestMerge(sessionId)
      if (result.mergeMode === 'pull-request') {
        setStatusMessage(`Opened pull request: ${result.pullRequestUrl ?? ''}`)
      } else if (result.mergeMode === 'local-merge') {
        setStatusMessage('Merged into the main branch.')
      } else {
        setStatusMessage('Merge mode is Manual — merge the Diff yourself.')
      }
      await refreshSessions()
    } catch (error) {
      setStatusMessage(`Failed to request merge: ${describeError(error)}`)
    }
  }

  async function handleAdoptSession(pid: number, directory: string): Promise<void> {
    try {
      await window.orca.adoptSession(pid, directory)
      await refreshAll()
      setStatusMessage('')
    } catch (error) {
      setStatusMessage(`Failed to adopt session: ${describeError(error)}`)
      throw error
    }
  }

  async function handleDiscardWorktree(sessionId: string): Promise<void> {
    // Discarding permanently throws away whatever unreviewed/unmerged work is
    // still sitting in the worktree - confirm before doing something the user
    // can't undo from within Orca.
    if (!window.confirm('Discard this worktree? Any unmerged changes will be permanently lost.')) {
      return
    }

    try {
      await window.orca.discardWorktree(sessionId)
      await refreshSessions()
      setStatusMessage('')
    } catch (error) {
      setStatusMessage(`Failed to discard worktree: ${describeError(error)}`)
    }
  }

  if (view.type === 'diff') {
    return <DiffScreen sessionId={view.sessionId} sessions={sessions} onBack={backToDashboard} />
  }

  if (view.type === 'session') {
    return (
      <SessionScreen
        sessionId={view.sessionId}
        sessions={sessions}
        onBack={backToDashboard}
        onStop={handleStopSession}
        onRespond={handleRespondToPrompt}
        onRequestMerge={handleRequestMerge}
        onDiscardWorktree={handleDiscardWorktree}
      />
    )
  }

  return (
    <Dashboard
      projects={projects}
      sessions={sessions}
      statusMessage={statusMessage || loadError}
      onAddProject={handleAddProject}
      onNewSession={handleNewSession}
      onSetProjectMergeMode={handleSetProjectMergeMode}
      onAdoptSession={handleAdoptSession}
      onOpenSession={openSession}
      onOpenDiff={openDiff}
      onStop={handleStopSession}
      onRequestMerge={handleRequestMerge}
      onDiscardWorktree={handleDiscardWorktree}
    />
  )
}
