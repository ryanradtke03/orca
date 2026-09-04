import type { FileDiff, Session, SessionStatus } from '../../shared/ipc-contract'
import { renderFileStats, renderFileStatusBadge } from './diff-view'
import { el } from './dom'
import { renderPromptActions, renderPromptText, renderReplyForm } from './prompt-view'
import { canDiscardWorktree, canRequestMerge, describeStatus, isStoppable, isTerminalStatus } from './session-view'

function describeIdleChatMessage(status: SessionStatus): string {
  if (isTerminalStatus(status)) return `${describeStatus(status)} — no pending prompt.`
  return `${describeStatus(status)} — no pending prompt right now.`
}

function renderChatPane(session: Session): HTMLElement {
  const pane = el('div', { id: 'session-chat' })

  const prompt = session.pendingPrompt
  if (!prompt) {
    pane.append(el('div', { id: 'session-chat-empty', textContent: describeIdleChatMessage(session.status) }))
    return pane
  }

  pane.append(
    el('div', { className: 'session-chat-turn' }, [renderPromptText(prompt.text)]),
    prompt.type === 'permission' ? renderPromptActions(prompt, session.id) : renderReplyForm(session.id)
  )
  return pane
}

function renderHeaderActions(session: Session): HTMLElement {
  const actions = el('div', { className: 'header-actions' })

  if (isStoppable(session.status)) {
    const stopButton = el('button', { type: 'button', className: 'btn-ghost stop-session-button', textContent: 'Stop' })
    stopButton.dataset.sessionId = session.id
    actions.append(stopButton)
  }
  if (canRequestMerge(session)) {
    const mergeButton = el('button', {
      type: 'button',
      className: 'btn request-merge-button',
      textContent: 'Request merge'
    })
    mergeButton.dataset.sessionId = session.id
    actions.append(mergeButton)
  }
  if (canDiscardWorktree(session)) {
    const discardButton = el('button', {
      type: 'button',
      className: 'btn-ghost discard-worktree-button',
      textContent: 'Discard'
    })
    discardButton.dataset.sessionId = session.id
    actions.append(discardButton)
  }

  return actions
}

function renderSessionInfo(session: Session): HTMLElement {
  function infoRow(label: string, value: string): HTMLElement {
    return el('div', { className: 'session-info-row' }, [
      el('span', { className: 'label', textContent: label }),
      el('span', { className: 'value', textContent: value })
    ])
  }

  return el('div', { id: 'session-info' }, [
    infoRow('Branch', session.branch),
    infoRow('Status', describeStatus(session.status)),
    infoRow('Base ref', session.baseRef),
    infoRow('Worktree', session.worktreeRemoved ? `${session.worktreePath} (removed)` : session.worktreePath)
  ])
}

function renderFilesTouched(files: FileDiff[]): HTMLElement {
  if (files.length === 0) {
    return el('div', { id: 'session-files-touched' }, [
      el('div', { className: 'session-files-empty', textContent: 'No changes yet' })
    ])
  }

  return el(
    'div',
    { id: 'session-files-touched' },
    files.map((file) =>
      el('div', { className: 'session-file-row' }, [
        el('span', { className: 'path', textContent: file.path }),
        renderFileStatusBadge(file),
        el('span', { className: 'stats' }, renderFileStats(file))
      ])
    )
  )
}

function renderInspector(session: Session, files: FileDiff[]): HTMLElement {
  return el('aside', { id: 'session-inspector' }, [
    el('div', { className: 'section-label', textContent: 'Session info' }),
    renderSessionInfo(session),
    el('div', { className: 'section-label', textContent: 'Files touched' }),
    renderFilesTouched(files)
  ])
}

export function renderSessionScreen(session: Session, files: FileDiff[]): HTMLElement {
  const backButton = el('button', {
    type: 'button',
    id: 'session-back-button',
    className: 'btn-ghost',
    textContent: '← Back to sessions'
  })

  const header = el('div', { id: 'session-header' }, [
    backButton,
    el('div', { id: 'session-header-info' }, [
      el('div', { id: 'session-name', textContent: session.branch }),
      el('div', { id: 'session-status-label', textContent: describeStatus(session.status) })
    ]),
    renderHeaderActions(session)
  ])

  const main = el('main', { id: 'session-main' }, [header, renderChatPane(session)])

  return el('div', { id: 'session-screen' }, [main, renderInspector(session, files)])
}

export function renderSessionLoading(): HTMLElement {
  return el('div', { id: 'session-screen' }, [
    el('main', { id: 'session-main' }, [el('div', { id: 'session-chat-empty', textContent: 'Loading session…' })])
  ])
}

export function renderSessionLoadError(message: string): HTMLElement {
  const backButton = el('button', {
    type: 'button',
    id: 'session-back-button',
    className: 'btn-ghost',
    textContent: '← Back to sessions'
  })
  return el('div', { id: 'session-screen' }, [
    el('main', { id: 'session-main' }, [
      el('div', { id: 'session-header' }, [backButton]),
      el('div', { id: 'session-chat-empty', textContent: `Failed to load session: ${message}` })
    ])
  ])
}
