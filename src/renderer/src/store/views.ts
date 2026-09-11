import { create } from 'zustand'
import type { Session } from '@shared/domain'

/** The dashboard's view tabs. These are FILTERS over the session list, not storage. */
export type ViewKind = 'all' | 'needs-you' | 'saved' | 'preset' | 'per-project'

interface ViewState {
  view: ViewKind
  setView: (view: ViewKind) => void
}

export const useViewStore = create<ViewState>((set) => ({
  view: 'all',
  setView: (view) => set({ view })
}))

/**
 * Predicate for a view. `per-project` needs the active project id;
 * `saved`/`preset` are placeholders until presets are wired.
 */
export function viewPredicate(
  view: ViewKind,
  ctx: { activeProjectId: string | null }
): (s: Session) => boolean {
  switch (view) {
    case 'needs-you':
      return (s) => s.status === 'needs-you'
    case 'per-project':
      return (s) => s.projectId === ctx.activeProjectId
    case 'saved':
    case 'preset':
    case 'all':
    default:
      return () => true
  }
}
