import type { Project } from '../../shared/ipc-contract'

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

function renderProjectList(projects: Project[]): void {
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
    li.textContent = project.name
    li.title = project.path
    ul.appendChild(li)
  }
  list.appendChild(ul)
}

async function refreshProjects(): Promise<void> {
  try {
    const projects = await window.orca.listProjects()
    renderProjectList(projects)
    setStatus('')
  } catch (error) {
    setStatus(`Failed to load projects: ${describeError(error)}`)
  }
}

async function handleAddProject(): Promise<void> {
  try {
    const project = await window.orca.addProjectViaDialog()
    if (!project) return
    await refreshProjects()
  } catch (error) {
    setStatus(`Failed to add project: ${describeError(error)}`)
  }
}

async function render(): Promise<void> {
  renderShell()

  const addButton = document.querySelector<HTMLButtonElement>('#add-project-button')
  addButton?.addEventListener('click', () => void handleAddProject())

  await refreshProjects()
}

void render()
