import type { FileDiff, Session, SessionStatus, TranscriptMessage } from '../../shared/ipc-contract'
import { renderFileStats, renderFileStatusBadge } from './diff-view'
import { el } from './dom'
import { renderPromptActions, renderPromptText, renderReplyForm } from './prompt-view'
import {
  canDiscardWorktree,
  canRequestMerge,
  canSendMessage,
  describeStatus,
  isStoppable,
  isTerminalStatus
} from './session-view'

function describeUnavailableChatMessage(status: SessionStatus): string {
  if (isTerminalStatus(status)) return `${describeStatus(status)} — this session has ended.`
  return `${describeStatus(status)} — can't send a message while the session is busy.`
}

function renderTranscript(transcript: TranscriptMessage[]): HTMLElement {
  return el(
    'div',
    { id: 'session-chat-transcript' },
    transcript.map((message) =>
      el('div', { className: `session-chat-turn session-chat-turn-${message.role}` }, [
        el('pre', { className: 'session-chat-turn-text', textContent: message.text })
      ])
    )
  )
}

function renderChatPane(session: Session, transcript: TranscriptMessage[]): HTMLElement {
  const pane = el('div', { id: 'session-chat' })
  if (transcript.length > 0) pane.append(renderTranscript(transcript))

  const prompt = session.pendingPrompt
  if (prompt) {
    pane.append(el('div', { className: 'session-chat-turn' }, [renderPromptText(prompt.text)]))
  }

  if (prompt?.type === 'permission') {
    pane.append(renderPromptActions(prompt, session.id))
  } else if (canSendMessage(session.status)) {
    // Only worth calling out explicitly when there's nothing else on the
    // page yet - once the transcript or a captured prompt is showing, the
    // message input below speaks for itself.
    if (transcript.length === 0 && !prompt) {
      pane.append(el('div', { className: 'session-chat-hint', textContent: 'No messages yet.' }))
    }
    pane.append(renderReplyForm(session.id))
  } else {
    pane.append(el('div', { className: 'session-chat-hint', textContent: describeUnavailableChatMessage(session.status) }))
  }

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

export function renderSessionScreen(session: Session, files: FileDiff[], transcript: TranscriptMessage[]): HTMLElement {
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

  const main = el('main', { id: 'session-main' }, [header, renderChatPane(session, transcript)])

  return el('div', { id: 'session-screen' }, [main, renderInspector(session, files)])
}

export function renderSessionLoading(): HTMLElement {
  return el('div', { id: 'session-screen' }, [
    el('main', { id: 'session-main' }, [el('div', { className: 'session-chat-hint', textContent: 'Loading session…' })])
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
      el('div', { className: 'session-chat-hint', textContent: `Failed to load session: ${message}` })
    ])
  ])
}
