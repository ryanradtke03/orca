import type { Project, Session } from '../../shared/ipc-contract'

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

function renderSessionList(sessions: Session[]): HTMLUListElement {
  const ul = document.createElement('ul')
  ul.className = 'session-list'

  for (const session of sessions) {
    const li = document.createElement('li')
    li.textContent = session.branch
    li.title = session.worktreePath
    ul.appendChild(li)
  }

  return ul
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

function handleProjectListClick(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  const button = target.closest<HTMLButtonElement>('.new-session-button')
  const projectId = button?.dataset.projectId
  if (!projectId) return

  void handleNewSession(projectId)
}

async function render(): Promise<void> {
  renderShell()

  const addButton = document.querySelector<HTMLButtonElement>('#add-project-button')
  addButton?.addEventListener('click', () => void handleAddProject())

  const projectList = document.querySelector<HTMLDivElement>('#project-list')
  projectList?.addEventListener('click', handleProjectListClick)

  await refreshAll()
}

void render()
