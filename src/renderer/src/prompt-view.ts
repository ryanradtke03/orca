import { resolvePermissionResponses } from '../../shared/prompt-options'
import type { PendingPrompt, SessionStatus } from '../../shared/ipc-contract'
import { el } from './dom'

export function renderStatusMarker(status: SessionStatus): HTMLElement {
  if (status === 'waiting-on-permission') {
    return el('span', { className: 'marker-diamond' })
  }
  if (status === 'waiting-on-input') {
    return el('span', { className: 'marker-ring' })
  }
  if (status === 'done') {
    return el('span', { textContent: '✓' })
  }
  if (status === 'errored') {
    return el('span', { className: 'errored-mark', textContent: '✕' })
  }
  const dotClass = status === 'running' ? 'dot-running' : status === 'idle' ? 'dot-idle' : 'dot-terminal'
  return el('span', { className: `dot ${dotClass}` })
}

export function renderPromptText(text: string): HTMLPreElement {
  return el('pre', { className: 'prompt-text', textContent: text })
}

export function renderReplyForm(sessionId: string): HTMLFormElement {
  const form = el('form', { className: 'reply-form' })
  form.dataset.sessionId = sessionId

  const input = el('input', {
    type: 'text',
    className: 'reply-input',
    placeholder: 'Type a reply…',
    autocomplete: 'off',
    required: true
  })
  input.dataset.sessionId = sessionId

  const sendButton = el('button', { type: 'submit', className: 'btn', textContent: 'Reply' })

  form.append(input, sendButton)
  return form
}

export function renderPromptActions(prompt: PendingPrompt, sessionId: string): HTMLElement {
  const { approve, deny } = resolvePermissionResponses(prompt.text)

  const denyButton = el('button', {
    type: 'button',
    className: 'btn-ghost',
    textContent: 'Deny'
  })
  denyButton.dataset.sessionId = sessionId
  denyButton.dataset.response = deny
  denyButton.classList.add('deny-prompt-button')

  const approveButton = el('button', {
    type: 'button',
    className: 'btn',
    textContent: 'Approve'
  })
  approveButton.dataset.sessionId = sessionId
  approveButton.dataset.response = approve
  approveButton.classList.add('approve-prompt-button')

  return el('div', { className: 'actions' }, [denyButton, approveButton])
}
