import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    // Also expose ORCA_-prefixed env (e.g. ORCA_DEMO, set by `npm run dev:demo`)
    // to the renderer so the mode badge can tell demo from live. Main reads the
    // same ORCA_DEMO var to select its engine.
    envPrefix: ['VITE_', 'ORCA_'],
    plugins: [react(), tailwindcss()]
  }
})
