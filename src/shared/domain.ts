import type { WorkspaceNode } from './layout'

/**
 * A session's lifecycle status. The dashboard "views" filter over this:
 *   - `needs-you` is the heuristic "an agent is waiting for input" state.
 */
export type SessionStatus = 'running' | 'needs-you' | 'idle' | 'exited'

/** One spawned PTY + its metadata. The live process lives in main; this is the mirror. */
export interface Session {
  id: string
  projectId: string
  title: string
  status: SessionStatus
  cwd: string
  /** Command/shell that was spawned, for display. */
  shell: string
  createdAt: number
}

/** A working directory + its saved tiling layout. Owns many sessions. */
export interface Project {
  id: string
  name: string
  path: string
  /** Persisted tiling layout for this project; null until the user arranges panes. */
  layout: WorkspaceNode | null
}

/** A saved arrangement the user can recall (the "preset"/"saved" views). */
export interface LayoutPreset {
  id: string
  name: string
  layout: WorkspaceNode
}
