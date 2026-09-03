import { resolvePermissionResponses } from '../../shared/prompt-options'
import type { PendingPrompt, Project, Session } from '../../shared/ipc-contract'

const SESSION_STATUS_POLL_INTERVAL_MS = 2000

const app = document.querySelector<HTMLDivElement>('#app')

function renderShell(): void {
  if (!app) return

  app.innerHTML = `
    <aside id="sidebar">
      <h1>Orca</h1>
      <div id="project-list"></div>
      <button id="add-project-button" type="button">Add Project</button>
      <p id="status" role="alert"></p>
    </aside>
  `
}

function setStatus(message: string): void {
  const status = document.querySelector<HTMLParagraphElement>('#status')
  if (status) status.textContent = message
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const STOPPABLE_STATUSES: ReadonlySet<Session['status']> = new Set([
  'running',
  'waiting-on-permission',
  'waiting-on-input'
])

function renderSessionList(sessions: Session[]): HTMLUListElement {
  const ul = document.createElement('ul')
  ul.className = 'session-list'

  for (const session of sessions) {
    const li = document.createElement('li')
    li.title = session.worktreePath
    li.dataset.sessionId = session.id

    const label = document.createElement('span')
    label.textContent = session.branch
    li.appendChild(label)

    const statusBadge = document.createElement('span')
    statusBadge.className = 'session-status'
    statusBadge.dataset.status = session.status
    statusBadge.textContent = session.status
    li.appendChild(statusBadge)

    if (session.pendingPrompt) {
      li.appendChild(renderPendingPrompt(session.pendingPrompt, session.id))
    }

    if (STOPPABLE_STATUSES.has(session.status)) {
      const stopButton = document.createElement('button')
      stopButton.type = 'button'
      stopButton.className = 'stop-session-button'
      stopButton.textContent = 'Stop'
      stopButton.dataset.sessionId = session.id
      li.appendChild(stopButton)
    }

    ul.appendChild(li)
  }

  return ul
}

function renderPendingPrompt(prompt: PendingPrompt, sessionId: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'pending-prompt'
  wrapper.dataset.promptType = prompt.type
  wrapper.dataset.promptText = prompt.text

  const label = document.createElement('span')
  label.className = 'pending-prompt-label'
  label.textContent = prompt.type === 'permission' ? 'Waiting on permission' : 'Waiting on input'
  wrapper.appendChild(label)

  const text = document.createElement('pre')
  text.className = 'pending-prompt-text'
  text.textContent = prompt.text
  wrapper.appendChild(text)

  if (prompt.type === 'permission') {
    wrapper.appendChild(renderPromptActions(prompt, sessionId))
  } else {
    wrapper.appendChild(renderReplyForm(sessionId))
  }

  return wrapper
}

function renderReplyForm(sessionId: string): HTMLFormElement {
  const form = document.createElement('form')
  form.className = 'pending-prompt-reply'
  form.dataset.sessionId = sessionId

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'pending-prompt-reply-input'
  input.placeholder = 'Type a reply…'
  input.autocomplete = 'off'
  input.required = true
  form.appendChild(input)

  const sendButton = document.createElement('button')
  sendButton.type = 'submit'
  sendButton.className = 'reply-prompt-button'
  sendButton.textContent = 'Send'
  form.appendChild(sendButton)

  return form
}

function renderPromptActions(prompt: PendingPrompt, sessionId: string): HTMLElement {
  const { approve, deny } = resolvePermissionResponses(prompt.text)

  const actions = document.createElement('div')
  actions.className = 'pending-prompt-actions'

  const approveButton = document.createElement('button')
  approveButton.type = 'button'
  approveButton.className = 'approve-prompt-button'
  approveButton.textContent = 'Approve'
  approveButton.dataset.sessionId = sessionId
  approveButton.dataset.response = approve
  actions.appendChild(approveButton)

  const denyButton = document.createElement('button')
  denyButton.type = 'button'
  denyButton.className = 'deny-prompt-button'
  denyButton.textContent = 'Deny'
  denyButton.dataset.sessionId = sessionId
  denyButton.dataset.response = deny
  actions.appendChild(denyButton)

  return actions
}

function renderProjectList(projects: Project[], sessions: Session[]): void {
  const list = document.querySelector<HTMLDivElement>('#project-list')
  if (!list) return

  list.innerHTML = ''

  if (projects.length === 0) {
    const emptyState = document.createElement('p')
    emptyState.id = 'empty-state'
    emptyState.textContent = 'No projects yet. Add your first project to get started.'
    list.appendChild(emptyState)
    return
  }

  const ul = document.createElement('ul')
  for (const project of projects) {
    const li = document.createElement('li')

    const name = document.createElement('span')
    name.textContent = project.name
    name.title = project.path
    li.appendChild(name)

    const newSessionButton = document.createElement('button')
    newSessionButton.type = 'button'
    newSessionButton.className = 'new-session-button'
    newSessionButton.textContent = 'New Session'
    newSessionButton.dataset.projectId = project.id
    li.appendChild(newSessionButton)

    const projectSessions = sessions.filter((session) => session.projectId === project.id)
    li.appendChild(renderSessionList(projectSessions))

    ul.appendChild(li)
  }
  list.appendChild(ul)
}

async function refreshAll(): Promise<void> {
  try {
    const [projects, sessions] = await Promise.all([
      window.orca.listProjects(),
      window.orca.listSessions()
    ])
    renderProjectList(projects, sessions)
    setStatus('')
  } catch (error) {
    setStatus(`Failed to load projects: ${describeError(error)}`)
  }
}

async function handleAddProject(): Promise<void> {
  try {
    const project = await window.orca.addProjectViaDialog()
    if (!project) return
    await refreshAll()
  } catch (error) {
    setStatus(`Failed to add project: ${describeError(error)}`)
  }
}

async function handleNewSession(projectId: string): Promise<void> {
  try {
    await window.orca.spawnSession(projectId)
    await refreshAll()
  } catch (error) {
    setStatus(`Failed to spawn session: ${describeError(error)}`)
  }
}

function updateSessionRows(sessions: Session[]): void {
  for (const session of sessions) {
    const li = document.querySelector<HTMLLIElement>(`li[data-session-id="${session.id}"]`)
    if (!li) continue

    const badge = li.querySelector<HTMLSpanElement>('.session-status')
    if (badge) {
      badge.dataset.status = session.status
      badge.textContent = session.status
    }

    const existingPrompt = li.querySelector<HTMLElement>('.pending-prompt')
    const promptUnchanged =
      existingPrompt !== null &&
      session.pendingPrompt !== undefined &&
      existingPrompt.dataset.promptType === session.pendingPrompt.type &&
      existingPrompt.dataset.promptText === session.pendingPrompt.text
    if (!promptUnchanged) {
      existingPrompt?.remove()
      if (session.pendingPrompt) {
        badge?.after(renderPendingPrompt(session.pendingPrompt, session.id))
      }
    }

    const existingStopButton = li.querySelector<HTMLButtonElement>('.stop-session-button')
    if (STOPPABLE_STATUSES.has(session.status)) {
      if (!existingStopButton) {
        const stopButton = document.createElement('button')
        stopButton.type = 'button'
        stopButton.className = 'stop-session-button'
        stopButton.textContent = 'Stop'
        stopButton.dataset.sessionId = session.id
        li.appendChild(stopButton)
      }
    } else {
      existingStopButton?.remove()
    }
  }
}

async function pollSessionStatuses(): Promise<void> {
  try {
    const sessions = await window.orca.listSessions()
    updateSessionRows(sessions)
  } catch (error) {
    setStatus(`Failed to refresh session statuses: ${describeError(error)}`)
  }
}

async function handleStopSession(sessionId: string): Promise<void> {
  try {
    await window.orca.stopSession(sessionId)
    // Updates rows in place rather than refreshAll()'s full teardown, which would
    // wipe any text a user is mid-typing into another session's reply field.
    await pollSessionStatuses()
  } catch (error) {
    setStatus(`Failed to stop session: ${describeError(error)}`)
  }
}

async function handleRespondToPrompt(sessionId: string, response: string): Promise<void> {
  try {
    await window.orca.respondToPrompt(sessionId, response)
    // Updates rows in place rather than refreshAll()'s full teardown, which would
    // wipe any text a user is mid-typing into another session's reply field.
    await pollSessionStatuses()
  } catch (error) {
    setStatus(`Failed to respond to prompt: ${describeError(error)}`)
  }
}

function handleProjectListClick(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  const newSessionButton = target.closest<HTMLButtonElement>('.new-session-button')
  if (newSessionButton?.dataset.projectId) {
    void handleNewSession(newSessionButton.dataset.projectId)
    return
  }

  const stopSessionButton = target.closest<HTMLButtonElement>('.stop-session-button')
  if (stopSessionButton?.dataset.sessionId) {
    void handleStopSession(stopSessionButton.dataset.sessionId)
    return
  }

  const promptActionButton = target.closest<HTMLButtonElement>(
    '.approve-prompt-button, .deny-prompt-button'
  )
  if (promptActionButton?.dataset.sessionId && promptActionButton.dataset.response) {
    void handleRespondToPrompt(promptActionButton.dataset.sessionId, promptActionButton.dataset.response)
  }
}

function handleProjectListSubmit(event: Event): void {
  const form = event.target
  if (!(form instanceof HTMLFormElement) || !form.classList.contains('pending-prompt-reply')) {
    return
  }
  event.preventDefault()

  const sessionId = form.dataset.sessionId
  const input = form.querySelector<HTMLInputElement>('.pending-prompt-reply-input')
  const reply = input?.value.trim()
  if (!sessionId) return
  // `required` blocks a fully empty submit; this catches the whitespace-only case
  // it can't, so the user still sees why nothing was sent instead of silence.
  if (!reply) {
    setStatus('Reply cannot be blank.')
    return
  }

  void handleRespondToPrompt(sessionId, reply)
}

async function render(): Promise<void> {
  renderShell()

  const addButton = document.querySelector<HTMLButtonElement>('#add-project-button')
  addButton?.addEventListener('click', () => void handleAddProject())

  const projectList = document.querySelector<HTMLDivElement>('#project-list')
  projectList?.addEventListener('click', handleProjectListClick)
  projectList?.addEventListener('submit', handleProjectListSubmit)

  await refreshAll()

  setInterval(() => void pollSessionStatuses(), SESSION_STATUS_POLL_INTERVAL_MS)
}

void render()
