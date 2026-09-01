const app = document.querySelector<HTMLDivElement>('#app')

function renderShell(): HTMLParagraphElement | null {
  if (!app) return null

  app.innerHTML = `
    <h1>Orca</h1>
    <p id="status">Contacting Engine...</p>
  `

  return app.querySelector<HTMLParagraphElement>('#status')
}

async function render(): Promise<void> {
  const status = renderShell()
  if (!status) return

  try {
    const result = await window.orca.ping()
    status.textContent = `Engine says: ok=${result.ok}, sessionCount=${result.sessionCount}`
  } catch (error) {
    status.textContent = `Engine ping failed: ${error instanceof Error ? error.message : String(error)}`
  }
}

void render()
