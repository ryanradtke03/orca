import type { FileDiff, MergeMode, Project, Session, TranscriptMessage } from '../../shared/ipc-contract'
import { renderDiffLoadError, renderDiffLoading, renderDiffScreen } from './diff-view'
import { el } from './dom'
import { renderPromptText, renderStatusMarker } from './prompt-view'
import { renderSessionLoadError, renderSessionLoading, renderSessionScreen } from './session-page'
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

type View = { type: 'dashboard' } | { type: 'diff'; sessionId: string } | { type: 'session'; sessionId: string }
let currentView: View = { type: 'dashboard' }

// Whether the Adopt form (sidebar footer) is expanded - reset once an adopt
// succeeds, but otherwise left open across re-renders so a failed attempt's
// status message stays next to the form the user can retry from.
let adoptFormOpen = false

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  const openButton = el('button', {
    type: 'button',
    className: 'open-session-button',
    textContent: 'Open'
  })
  openButton.dataset.sessionId = session.id
  action.append(openButton)
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

// Navigational only - interacting with the prompt itself now happens on the
// session page (#43), so this row carries a sessionId for handleAppClick to
// open rather than any inline reply/approve-deny UI.
function renderNeedsYouRow(session: Session): HTMLElement {
  const prompt = session.pendingPrompt
  if (!prompt) throw new Error(`renderNeedsYouRow called for session without a pending prompt: ${session.id}`)

  const row = el('div', { className: 'needs-you-row' })
  row.dataset.sessionId = session.id

  const marker = el('div', { className: 'marker' }, [renderStatusMarker(session.status)])
  const body = el('div', { className: 'body' }, [
    el('div', { className: 'session-name', textContent: session.branch }),
    renderPromptText(prompt.text)
  ])
  const openHint = el('span', { className: 'needs-you-open-hint', textContent: 'Open →' })

  row.append(marker, body, openHint)

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

// A freshly spawned Session comes up with nothing queued - giving it its
// first task is done from the session page's always-available message input
// once it's idle (#45), not at spawn time.
function renderNewSessionForm(projectId: string): HTMLFormElement {
  const form = el('form', { className: 'new-session-form' })
  form.dataset.projectId = projectId

  const spawnButton = el('button', { type: 'submit', className: 'btn new-session-button', textContent: 'New session' })

  form.append(spawnButton)
  return form
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

  header.append(renderNewSessionForm(group.project.id))

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

  const sessionId = active.dataset.sessionId
  if (!sessionId) return null

  return {
    selector: `.reply-input[data-session-id="${sessionId}"]`,
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
// a view that needs it (Diff, Session) is opened. `requestToken` guards
// against a slow fetch resolving after the user has already navigated
// elsewhere and clobbering whatever view they're now on.
let viewRequestToken = 0

async function renderDiffView(sessionId: string): Promise<void> {
  if (!app) return
  const token = ++viewRequestToken

  app.innerHTML = ''
  app.append(renderDiffLoading())

  const session = latestSessions.find((candidate) => candidate.id === sessionId)
  if (!session) {
    if (token !== viewRequestToken) return
    app.innerHTML = ''
    app.append(renderDiffLoadError(`Unknown session: ${sessionId}`))
    return
  }

  try {
    const files = await window.orca.getDiff(sessionId)
    if (token !== viewRequestToken) return
    app.innerHTML = ''
    app.append(renderDiffScreen(session, files))
  } catch (error) {
    if (token !== viewRequestToken) return
    app.innerHTML = ''
    app.append(renderDiffLoadError(describeError(error)))
  }
}

// The session page's "files touched" panel reuses `getDiff`, cached here so
// the 2s status poll (which does re-render this view, to keep the pending
// prompt and lifecycle actions live) doesn't re-shell to `git diff` on every
// tick - only a fresh navigation to a session (handleAppClick, below) clears
// this and forces a re-fetch.
let sessionViewFilesCache: { sessionId: string; files: FileDiff[] } | null = null

// Unlike the diff cache above, the transcript is meant to live-update on the
// same 2s cadence as session status (#45) - this holds only the most
// recently fetched copy, refreshed every poll tick via refreshSessionTranscript.
let sessionViewTranscriptCache: { sessionId: string; transcript: TranscriptMessage[] } | null = null

// Guards against the 2s poll re-entering renderSessionPageView for the same
// session while its `getDiff` fetch is still in flight - without this, a
// fetch slower than the poll interval would have each tick start a new one
// that invalidates the last via `viewRequestToken`, so the cache never gets
// populated and the page never leaves "Loading session…".
let sessionViewFetchSessionId: string | null = null

// Guards against overlapping transcript fetches the same way, if one ever
// outlasts the 2s poll interval - a stale response finishing after the next
// tick already fetched fresher data would otherwise stomp it.
let transcriptFetchInFlight = false

async function refreshSessionTranscript(sessionId: string): Promise<void> {
  if (transcriptFetchInFlight) return
  transcriptFetchInFlight = true
  try {
    const transcript = await window.orca.getTranscript(sessionId)
    // The user may have navigated to a different session (or away entirely)
    // while this was in flight - don't let a stale response overwrite the
    // cache for whatever's actually being viewed now.
    if (currentView.type === 'session' && currentView.sessionId === sessionId) {
      sessionViewTranscriptCache = { sessionId, transcript }
    }
  } catch (error) {
    if (currentView.type === 'session' && currentView.sessionId === sessionId) {
      setStatus(`Failed to load transcript: ${describeError(error)}`)
    }
  } finally {
    transcriptFetchInFlight = false
  }
}

async function renderSessionPageView(sessionId: string): Promise<void> {
  if (!app) return

  const session = latestSessions.find((candidate) => candidate.id === sessionId)
  if (!session) {
    viewRequestToken++
    app.innerHTML = ''
    app.append(renderSessionLoadError(`Unknown session: ${sessionId}`))
    return
  }

  if (sessionViewFilesCache?.sessionId === sessionId) {
    // Preserves an in-progress reply draft across the poll-driven re-render,
    // same as renderDashboard - otherwise typing a reply on this page would
    // be silently wiped out from under the user every 2s.
    const draft = captureFieldDraft()
    const transcript = sessionViewTranscriptCache?.sessionId === sessionId ? sessionViewTranscriptCache.transcript : []
    app.innerHTML = ''
    app.append(renderSessionScreen(session, sessionViewFilesCache.files, transcript))
    restoreFieldDraft(draft)
    void refreshSessionTranscript(sessionId)
    return
  }

  if (sessionViewFetchSessionId === sessionId) {
    app.innerHTML = ''
    app.append(renderSessionLoading())
    return
  }

  const token = ++viewRequestToken
  sessionViewFetchSessionId = sessionId

  app.innerHTML = ''
  app.append(renderSessionLoading())

  try {
    const [files, transcript] = await Promise.all([
      window.orca.getDiff(sessionId),
      window.orca.getTranscript(sessionId)
    ])
    if (token !== viewRequestToken) return
    sessionViewFilesCache = { sessionId, files }
    sessionViewTranscriptCache = { sessionId, transcript }
    const draft = captureFieldDraft()
    app.innerHTML = ''
    app.append(renderSessionScreen(session, files, transcript))
    restoreFieldDraft(draft)
  } catch (error) {
    if (token !== viewRequestToken) return
    app.innerHTML = ''
    app.append(renderSessionLoadError(describeError(error)))
  } finally {
    if (sessionViewFetchSessionId === sessionId) sessionViewFetchSessionId = null
  }
}

function renderApp(): void {
  if (currentView.type === 'diff') {
    void renderDiffView(currentView.sessionId)
    return
  }
  if (currentView.type === 'session') {
    void renderSessionPageView(currentView.sessionId)
    return
  }
  // Invalidates any diff/session fetch still in flight, so it can't resolve
  // after the user has navigated back and clobber the dashboard they're now on.
  viewRequestToken++
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
    // The dashboard and the session page both reflect live status polling -
    // the session page needs it to keep the pending prompt and lifecycle
    // actions current. The diff view is excluded: re-rendering it every 2s
    // would reset its scroll position and re-fetch a `git diff` no one asked for.
    if (currentView.type === 'dashboard' || currentView.type === 'session') renderApp()
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

// A fresh navigation to a session always drops the cached diff and
// transcript, so the session page reflects the session's current state
// rather than whatever was last fetched for it (or another session's, if
// this is a fresh navigation there instead).
function openSessionPage(sessionId: string): void {
  sessionViewFilesCache = null
  sessionViewTranscriptCache = null
  currentView = { type: 'session', sessionId }
  renderApp()
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

  const openSessionButton = target.closest<HTMLButtonElement>('.open-session-button')
  if (openSessionButton?.dataset.sessionId) {
    openSessionPage(openSessionButton.dataset.sessionId)
    return
  }

  const needsYouRow = target.closest<HTMLElement>('.needs-you-row')
  if (needsYouRow?.dataset.sessionId) {
    openSessionPage(needsYouRow.dataset.sessionId)
    return
  }

  if (target.closest('#diff-back-button') || target.closest('#session-back-button')) {
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
      setStatus('Message cannot be blank.')
      return
    }

    void handleRespondToPrompt(sessionId, reply)
    return
  }

  if (form.classList.contains('new-session-form')) {
    event.preventDefault()

    const projectId = form.dataset.projectId
    if (!projectId) return

    void handleNewSession(projectId)
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
