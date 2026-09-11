import type { DropZone } from '@shared/layout'
import type { Session } from '@shared/domain'
import { orca } from './ipc'
import { useSessionStore } from '@renderer/store/sessions'
import { useLayoutStore } from '@renderer/store/layout'

/**
 * Cross-store side effect: spawn a PTY in main, mirror the session into the
 * renderer store, and place a pane for it in the layout tree.
 */
export async function spawnSession(opts: {
  projectId: string
  cwd: string
  shell?: string
  target?: { leafId: string; zone: DropZone }
}): Promise<Session> {
  const session = await orca.spawnSession({
    projectId: opts.projectId,
    cwd: opts.cwd,
    shell: opts.shell,
    cols: 80,
    rows: 24
  })
  useSessionStore.getState().upsert(session)
  useLayoutStore.getState().addSession(session.id, opts.target)
  return session
}
