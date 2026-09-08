import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { installMockOrca, isMockMode } from './mock'
import './index.css'

// In mock mode (`npm run dev:mock`) swap the preload-provided `window.orca`
// for a fixture-backed fake before React renders. Plain `dev` and the build
// never enter this branch and keep using the real IPC path.
if (isMockMode()) installMockOrca()

const container = document.querySelector<HTMLDivElement>('#app')
if (!container) throw new Error('Missing #app root element')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
