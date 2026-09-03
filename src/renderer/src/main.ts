import { resolvePermissionResponses } from '../../shared/prompt-options'
import type { MergeMode, PendingPrompt, Project, Session, SessionStatus } from '../../shared/ipc-contract'
import { renderDiffLoadError, renderDiffLoading, renderDiffScreen } from './diff-view'
import { el } from './dom'
import {
  canDiscardWorktree,
  canRequestMerge,
  canViewDiff,
  describeMergeMode,
  describeStatus,
  groupSessionsByProject,
  isAttentionStatus,
  isStoppable,
  isTerminalStatus,
  needsAttentionSessions,
  MERGE_MODES,
  summarizeStatuses,
  type ProjectSessionGroup
} from './session-view'

const SESSION_STATUS_POLL_INTERVAL_MS = 2000

const app = document.querySelector<HTMLDivElement>('#app')

// The set of projects/sessions currently on screen, kept so the 2s status
// poll can re-render without re-fetching (and without racing) either list.
let latestProjects: Project[] = []
let latestSessions: Session[] = []

type View = { type: 'dashboard' } | { type: 'diff'; sessionId: string }
let currentView: View = { type: 'dashboard' }

// Whether the Adopt form (sidebar footer) is expanded - reset once an adopt
// succeeds, but otherwise left open across re-renders so a failed attempt's
// status message stays next to the form the user can retry from.
let adoptFormOpen = false

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function renderStatusMarker(status: SessionStatus): HTMLElement {
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

function renderSessionRow(session: Session): HTMLElement {
  const row = el('div', { className: 'session-row', title: session.worktreePath })
  if (isTerminalStatus(session.status)) row.classList.add('is-terminal')

  const marker = el('div', { className: 'marker' }, [renderStatusMarker(session.status)])
  const branch = el('div', { className: 'branch', textContent: session.branch })
  const statusLabel = el('div', {
    className: `status-label${isAttentionStatus(session.status) ? ' is-attention' : ''}`,
    textContent: describeStatus(session.status)
  })
  const action = el('div', { className: 'row-action' })
  if (canViewDiff(session)) {
    const diffButton = el('button', {
      type: 'button',
      className: 'view-diff-button',
      textContent: 'Diff'
    })
    diffButton.dataset.sessionId = session.id
    action.append(diffButton)
  }
  if (isStoppable(session.status)) {
    const stopButton = el('button', {
      type: 'button',
      className: 'stop-session-button',
      textContent: 'Stop'
    })
    stopButton.dataset.sessionId = session.id
    action.append(stopButton)
  }
  if (canRequestMerge(session)) {
    const mergeButton = el('button', {
      type: 'button',
      className: 'request-merge-button',
      textContent: 'Request merge'
    })
    mergeButton.dataset.sessionId = session.id
    action.append(mergeButton)
  }
  if (canDiscardWorktree(session)) {
    const discardButton = el('button', {
      type: 'button',
      className: 'discard-worktree-button',
      textContent: 'Discard'
    })
    discardButton.dataset.sessionId = session.id
    action.append(discardButton)
  }
  if (session.worktreeRemoved) {
    action.append(el('span', { className: 'worktree-removed-note', textContent: 'Worktree removed' }))
  }

  row.append(marker, branch, statusLabel, action)
  return row
}

function renderPromptText(text: string): HTMLPreElement {
  return el('pre', { className: 'prompt-text', textContent: text })
}

function renderReplyForm(sessionId: string): HTMLFormElement {
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

function renderPromptActions(prompt: PendingPrompt, sessionId: string): HTMLElement {
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

function renderNeedsYouRow(session: Session): HTMLElement {
  const prompt = session.pendingPrompt
  if (!prompt) throw new Error(`renderNeedsYouRow called for session without a pending prompt: ${session.id}`)

  const row = el('div', { className: 'needs-you-row' })

  const marker = el('div', { className: 'marker' }, [renderStatusMarker(session.status)])
  const body = el('div', { className: 'body' }, [
    el('div', { className: 'session-name', textContent: session.branch }),
    renderPromptText(prompt.text)
  ])

  row.append(marker, body)
  row.append(prompt.type === 'permission' ? renderPromptActions(prompt, session.id) : renderReplyForm(session.id))

  return row
}

function renderNeedsYouSection(attention: Session[]): HTMLElement {
  const section = el('div', { id: 'needs-you-section' })
  if (attention.length === 0) return section

  section.append(
    el('div', { className: 'section-heading' }, [
      el('div', { className: 'marker' }),
      el('span', { className: 'label', textContent: 'Needs you' }),
      el('div', { className: 'rule' })
    ]),
    el(
      'div',
      { id: 'needs-you-list' },
      attention.map((session) => renderNeedsYouRow(session))
    )
  )
  return section
}

function renderProjectGroup(group: ProjectSessionGroup): DocumentFragment {
  const fragment = document.createDocumentFragment()

  const header = el('div', { className: 'project-group-header', id: `project-group-${group.project.id}` }, [
    el('span', { className: 'name', textContent: group.project.name }),
    el('span', { className: 'path', textContent: group.project.path }),
    el('div', { className: 'rule' })
  ])
  const mergeModeSelect = el(
    'select',
    { className: 'merge-mode-select' },
    MERGE_MODES.map((mode) =>
      el('option', {
        value: mode,
        textContent: describeMergeMode(mode),
        selected: mode === group.project.mergeMode
      })
    )
  )
  mergeModeSelect.dataset.projectId = group.project.id
  header.append(mergeModeSelect)

  const newSessionButton = el('button', { type: 'button', className: 'btn new-session-button', textContent: 'New session' })
  newSessionButton.dataset.projectId = group.project.id
  header.append(newSessionButton)

  const table = el('div', { className: 'session-table' })
  if (group.sessions.length === 0) {
    table.append(el('div', { className: 'session-empty-row', textContent: 'No sessions yet' }))
  } else {
    for (const session of group.sessions) {
      table.append(renderSessionRow(session))
    }
  }

  fragment.append(header, table)
  return fragment
}

function renderMain(sessions: Session[], groups: ProjectSessionGroup[], attention: Session[]): HTMLElement {
  const main = el('main', { id: 'main' })

  const stats = summarizeStatuses(sessions)
  main.append(
    el('div', { id: 'main-header' }, [
      el('div', {}, [
        el('h1', { textContent: 'All sessions' }),
        el('div', { id: 'main-header-stats', textContent: stats || 'No sessions yet' })
      ])
    ])
  )

  main.append(renderNeedsYouSection(attention))

  const groupsContainer = el('div', { id: 'project-groups' })
  for (const group of groups) {
    groupsContainer.append(renderProjectGroup(group))
  }
  main.append(groupsContainer)

  return main
}

function renderEmptyState(): HTMLElement {
  return el('div', { id: 'empty-state' }, [
    el('div', { className: 'inner' }, [
      el('div', { className: 'glyph' }, [el('span', { className: 'dot dot-running' })]),
      el('h1', { textContent: 'Point Orca at a repository' }),
      el('p', {
        textContent:
          "Every Claude Code session you spawn gets its own worktree, and Orca watches all of them from here — status, prompts, diffs, in one window."
      }),
      el('div', { className: 'cta-row' }, [
        el('button', { type: 'button', id: 'empty-state-add-project', className: 'btn js-add-project', textContent: 'Add project…' })
      ]),
      el('div', { className: 'steps' }, [
        el('div', { className: 'step' }, [
          el('div', { className: 'index', textContent: '01' }),
          el('div', { className: 'desc', textContent: 'Pick a repo on disk' })
        ]),
        el('div', { className: 'step' }, [
          el('div', { className: 'index', textContent: '02' }),
          el('div', { className: 'desc', textContent: 'Spawn a session' })
        ]),
        el('div', { className: 'step' }, [
          el('div', { className: 'index', textContent: '03' }),
          el('div', { className: 'desc', textContent: 'Approve, review, merge' })
        ])
      ])
    ])
  ])
}

function renderSidebar(
  projects: Project[],
  sessions: Session[],
  groups: ProjectSessionGroup[],
  attention: Session[]
): HTMLElement {
  const sidebar = el('aside', { id: 'sidebar' })

  const subtitle =
    projects.length === 0 ? 'no projects' : `${sessions.length} sessions · ${projects.length} projects`
  sidebar.append(
    el('div', { id: 'sidebar-header' }, [
      el('div', { id: 'sidebar-title', textContent: 'Orca' }),
      el('div', { id: 'sidebar-subtitle', textContent: subtitle })
    ])
  )

  if (attention.length > 0) {
    const pill = el('button', { type: 'button', id: 'needs-you-pill' }, [
      el('span', { className: 'label', textContent: 'Needs you' }),
      el('span', { className: 'count', textContent: String(attention.length) })
    ])
    sidebar.append(pill)
  }

  const nav = el('div', { id: 'project-nav' }, [el('div', { className: 'section-label', textContent: 'Projects' })])
  for (const group of groups) {
    const row = el('button', { type: 'button', className: 'project-nav-row' }, [
      el('span', { className: 'name', textContent: group.project.name }),
      el('span', { className: 'count', textContent: String(group.sessions.length) })
    ])
    row.dataset.projectId = group.project.id
    nav.append(row)
  }
  sidebar.append(nav)

  sidebar.append(
    el('div', { id: 'sidebar-spacer' }),
    el('div', { id: 'sidebar-footer' }, [
      el('button', {
        type: 'button',
        id: 'add-project-button',
        className: 'js-add-project',
        textContent: '+ Add project'
      }),
      renderAdoptSection()
    ]),
    el('p', { id: 'sidebar-status', role: 'alert' })
  )

  return sidebar
}

function renderAdoptSection(): HTMLElement {
  const section = el('div', { id: 'adopt-section' })

  const toggle = el('button', {
    type: 'button',
    id: 'adopt-session-toggle',
    className: 'js-toggle-adopt',
    textContent: adoptFormOpen ? 'Cancel adopt' : 'Adopt session…'
  })
  section.append(toggle)

  if (adoptFormOpen) {
    const pidInput = el('input', {
      id: 'adopt-pid-input',
      type: 'text',
      inputMode: 'numeric',
      pattern: '[0-9]*',
      className: 'adopt-input',
      placeholder: 'PID',
      autocomplete: 'off',
      required: true
    })
    const directoryInput = el('input', {
      id: 'adopt-directory-input',
      type: 'text',
      className: 'adopt-input',
      placeholder: 'Working directory',
      autocomplete: 'off',
      required: true
    })
    const submitButton = el('button', { type: 'submit', className: 'btn', textContent: 'Adopt' })

    const form = el('form', { id: 'adopt-session-form', className: 'adopt-form' }, [
      pidInput,
      directoryInput,
      submitButton
    ])
    section.append(form)
  }

  return section
}

function setStatus(message: string): void {
  const status = document.querySelector<HTMLParagraphElement>('#sidebar-status')
  if (status) status.textContent = message
}

// Preserves whatever the user is mid-typing into a reply field across a
// re-render, since a full rebuild would otherwise replace the input under
// their cursor and silently drop the draft.
interface FieldDraft {
  selector: string
  value: string
  selectionStart: number | null
}

function captureFieldDraft(): FieldDraft | null {
  const active = document.activeElement
  if (!(active instanceof HTMLInputElement) || !active.classList.contains('reply-input')) return null
  if (!active.dataset.sessionId) return null
  return {
    selector: `.reply-input[data-session-id="${active.dataset.sessionId}"]`,
    value: active.value,
    selectionStart: active.selectionStart
  }
}

function restoreFieldDraft(draft: FieldDraft | null): void {
  if (!draft) return
  const input = document.querySelector<HTMLInputElement>(draft.selector)
  if (!input) return
  input.value = draft.value
  input.focus()
  if (draft.selectionStart !== null) input.setSelectionRange(draft.selectionStart, draft.selectionStart)
}

// Preserves both Adopt form fields (not just the focused one) across a
// re-render - a single-input draft would silently drop whichever field
// isn't currently focused every time the 2s status poll rebuilds the sidebar.
interface AdoptFormDraft {
  pid: string
  directory: string
  focusedId: 'adopt-pid-input' | 'adopt-directory-input' | null
  selectionStart: number | null
}

function captureAdoptFormDraft(): AdoptFormDraft | null {
  const pidInput = document.querySelector<HTMLInputElement>('#adopt-pid-input')
  const directoryInput = document.querySelector<HTMLInputElement>('#adopt-directory-input')
  if (!pidInput || !directoryInput) return null

  const active = document.activeElement
  const focusedId =
    active instanceof HTMLInputElement && (active.id === 'adopt-pid-input' || active.id === 'adopt-directory-input')
      ? active.id
      : null

  return {
    pid: pidInput.value,
    directory: directoryInput.value,
    focusedId,
    selectionStart: focusedId && active instanceof HTMLInputElement ? active.selectionStart : null
  }
}

function restoreAdoptFormDraft(draft: AdoptFormDraft | null): void {
  if (!draft) return
  const pidInput = document.querySelector<HTMLInputElement>('#adopt-pid-input')
  const directoryInput = document.querySelector<HTMLInputElement>('#adopt-directory-input')
  if (pidInput) pidInput.value = draft.pid
  if (directoryInput) directoryInput.value = draft.directory

  if (!draft.focusedId) return
  const focused = document.querySelector<HTMLInputElement>(`#${draft.focusedId}`)
  if (!focused) return
  focused.focus()
  if (draft.selectionStart !== null) focused.setSelectionRange(draft.selectionStart, draft.selectionStart)
}

// Preserves how far the user has scrolled the session list / project nav
// across a re-render, since a full rebuild would otherwise replace both
// scroll containers with fresh (scrollTop 0) nodes on every 2s status poll.
interface ScrollPositions {
  main: number
  projectNav: number
}

function captureScrollPositions(): ScrollPositions {
  return {
    main: document.querySelector('#main')?.scrollTop ?? 0,
    projectNav: document.querySelector('#project-nav')?.scrollTop ?? 0
  }
}

function restoreScrollPositions(positions: ScrollPositions): void {
  const main = document.querySelector('#main')
  if (main) main.scrollTop = positions.main
  const projectNav = document.querySelector('#project-nav')
  if (projectNav) projectNav.scrollTop = positions.projectNav
}

function renderDashboard(projects: Project[], sessions: Session[]): void {
  if (!app) return
  const draft = captureFieldDraft()
  const adoptDraft = captureAdoptFormDraft()
  const scrollPositions = captureScrollPositions()

  const groups = groupSessionsByProject(projects, sessions)
  const attention = needsAttentionSessions(sessions)

  app.innerHTML = ''
  app.append(renderSidebar(projects, sessions, groups, attention))
  app.append(projects.length === 0 ? renderEmptyState() : renderMain(sessions, groups, attention))

  restoreFieldDraft(draft)
  restoreAdoptFormDraft(adoptDraft)
  restoreScrollPositions(scrollPositions)
}

// Diff data isn't part of the 2s status poll (shelling out to `git diff` on
// every tick for every session would be wasteful) - it's fetched once when
// the view is opened. `requestToken` guards against a slow fetch resolving
// after the user has already navigated elsewhere and clobbering that view.
let diffRequestToken = 0

async function renderDiffView(sessionId: string): Promise<void> {
  if (!app) return
  const token = ++diffRequestToken

  app.innerHTML = ''
  app.append(renderDiffLoading())

  const session = latestSessions.find((candidate) => candidate.id === sessionId)
  if (!session) {
    if (token !== diffRequestToken) return
    app.innerHTML = ''
    app.append(renderDiffLoadError(`Unknown session: ${sessionId}`))
    return
  }

  try {
    const files = await window.orca.getDiff(sessionId)
    if (token !== diffRequestToken) return
    app.innerHTML = ''
    app.append(renderDiffScreen(session, files))
  } catch (error) {
    if (token !== diffRequestToken) return
    app.innerHTML = ''
    app.append(renderDiffLoadError(describeError(error)))
  }
}

function renderApp(): void {
  if (currentView.type === 'diff') {
    void renderDiffView(currentView.sessionId)
    return
  }
  // Invalidates any diff fetch still in flight, so it can't resolve after
  // the user has navigated back and clobber the dashboard they're now on.
  diffRequestToken++
  renderDashboard(latestProjects, latestSessions)
}

async function refreshAll(): Promise<void> {
  try {
    const [projects, sessions] = await Promise.all([window.orca.listProjects(), window.orca.listSessions()])
    latestProjects = projects
    latestSessions = sessions
    renderApp()
    setStatus('')
  } catch (error) {
    setStatus(`Failed to load projects: ${describeError(error)}`)
  }
}

async function pollSessionStatuses(): Promise<void> {
  try {
    const sessions = await window.orca.listSessions()
    latestSessions = sessions
    // Only the dashboard reflects live status polling - re-rendering the
    // diff view every 2s would reset its scroll position and re-fetch a
    // `git diff` no one asked for.
    if (currentView.type === 'dashboard') renderApp()
  } catch (error) {
    setStatus(`Failed to refresh session statuses: ${describeError(error)}`)
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

async function handleStopSession(sessionId: string): Promise<void> {
  try {
    await window.orca.stopSession(sessionId)
    await pollSessionStatuses()
  } catch (error) {
    setStatus(`Failed to stop session: ${describeError(error)}`)
  }
}

async function handleRespondToPrompt(sessionId: string, response: string): Promise<void> {
  try {
    await window.orca.respondToPrompt(sessionId, response)
    await pollSessionStatuses()
  } catch (error) {
    setStatus(`Failed to respond to prompt: ${describeError(error)}`)
  }
}

async function handleSetProjectMergeMode(projectId: string, mergeMode: MergeMode): Promise<void> {
  try {
    await window.orca.setProjectMergeMode(projectId, mergeMode)
    await refreshAll()
  } catch (error) {
    setStatus(`Failed to set merge mode: ${describeError(error)}`)
  }
}

async function handleRequestMerge(sessionId: string): Promise<void> {
  try {
    const result = await window.orca.requestMerge(sessionId)
    if (result.mergeMode === 'pull-request') {
      setStatus(`Opened pull request: ${result.pullRequestUrl ?? ''}`)
    } else if (result.mergeMode === 'local-merge') {
      setStatus('Merged into the main branch.')
    } else {
      setStatus('Merge mode is Manual — merge the Diff yourself.')
    }
    await pollSessionStatuses()
  } catch (error) {
    setStatus(`Failed to request merge: ${describeError(error)}`)
  }
}

async function handleAdoptSession(pid: number, directory: string): Promise<void> {
  try {
    await window.orca.adoptSession(pid, directory)
    adoptFormOpen = false
    await refreshAll()
  } catch (error) {
    setStatus(`Failed to adopt session: ${describeError(error)}`)
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
    await pollSessionStatuses()
  } catch (error) {
    setStatus(`Failed to discard worktree: ${describeError(error)}`)
  }
}

function scrollToId(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handleAppClick(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  const diffButton = target.closest<HTMLButtonElement>('.view-diff-button')
  if (diffButton?.dataset.sessionId) {
    currentView = { type: 'diff', sessionId: diffButton.dataset.sessionId }
    renderApp()
    return
  }

  if (target.closest('#diff-back-button')) {
    currentView = { type: 'dashboard' }
    renderApp()
    return
  }

  const diffFileNavRow = target.closest<HTMLButtonElement>('.diff-file-nav-row')
  if (diffFileNavRow?.dataset.diffAnchorId) {
    scrollToId(diffFileNavRow.dataset.diffAnchorId)
    return
  }

  if (target.closest('.js-add-project')) {
    void handleAddProject()
    return
  }

  if (target.closest('.js-toggle-adopt')) {
    adoptFormOpen = !adoptFormOpen
    renderApp()
    return
  }

  if (target.closest('#needs-you-pill')) {
    scrollToId('needs-you-section')
    return
  }

  const projectNavRow = target.closest<HTMLButtonElement>('.project-nav-row')
  if (projectNavRow?.dataset.projectId) {
    scrollToId(`project-group-${projectNavRow.dataset.projectId}`)
    return
  }

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

  const promptActionButton = target.closest<HTMLButtonElement>('.approve-prompt-button, .deny-prompt-button')
  if (promptActionButton?.dataset.sessionId && promptActionButton.dataset.response) {
    void handleRespondToPrompt(promptActionButton.dataset.sessionId, promptActionButton.dataset.response)
    return
  }

  const requestMergeButton = target.closest<HTMLButtonElement>('.request-merge-button')
  if (requestMergeButton?.dataset.sessionId) {
    void handleRequestMerge(requestMergeButton.dataset.sessionId)
    return
  }

  const discardWorktreeButton = target.closest<HTMLButtonElement>('.discard-worktree-button')
  if (discardWorktreeButton?.dataset.sessionId) {
    void handleDiscardWorktree(discardWorktreeButton.dataset.sessionId)
  }
}

function handleAppChange(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement) || !target.classList.contains('merge-mode-select')) return

  const projectId = target.dataset.projectId
  if (!projectId) return

  void handleSetProjectMergeMode(projectId, target.value as MergeMode)
}

function handleAppSubmit(event: Event): void {
  const form = event.target
  if (!(form instanceof HTMLFormElement)) return

  if (form.classList.contains('reply-form')) {
    event.preventDefault()

    const sessionId = form.dataset.sessionId
    const input = form.querySelector<HTMLInputElement>('.reply-input')
    const reply = input?.value.trim()
    if (!sessionId) return
    // `required` blocks a fully empty submit; this catches the whitespace-only case
    // it can't, so the user still sees why nothing was sent instead of silence.
    if (!reply) {
      setStatus('Reply cannot be blank.')
      return
    }

    void handleRespondToPrompt(sessionId, reply)
    return
  }

  if (form.id === 'adopt-session-form') {
    event.preventDefault()

    const pidValue = form.querySelector<HTMLInputElement>('#adopt-pid-input')?.value.trim()
    const directory = form.querySelector<HTMLInputElement>('#adopt-directory-input')?.value.trim()
    const pid = Number(pidValue)
    if (!pidValue || !Number.isInteger(pid) || pid <= 0 || !directory) {
      setStatus('Enter a valid PID and working directory to adopt.')
      return
    }

    void handleAdoptSession(pid, directory)
  }
}

async function main(): Promise<void> {
  app?.addEventListener('click', handleAppClick)
  app?.addEventListener('submit', handleAppSubmit)
  app?.addEventListener('change', handleAppChange)

  await refreshAll()

  setInterval(() => void pollSessionStatuses(), SESSION_STATUS_POLL_INTERVAL_MS)
}

void main()
