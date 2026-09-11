import { useEffect } from 'react'
import { orca } from '@renderer/lib/ipc'
import { useProjectStore, selectActiveProject } from '@renderer/store/projects'
import { useSessionStore } from '@renderer/store/sessions'
import { useLayoutStore } from '@renderer/store/layout'
import { ProjectList } from '@renderer/features/projects/ProjectList'
import { DashboardView } from '@renderer/features/dashboard/DashboardView'
import { ViewTabs } from '@renderer/features/dashboard/ViewTabs'
import { WorkspaceView } from '@renderer/features/workspace/WorkspaceView'

/** One-time hydration + event subscriptions. Main is the source of truth. */
function useBootstrap(): void {
  useEffect(() => {
    orca.listProjects().then((p) => useProjectStore.getState().setProjects(p))
    orca.listSessions().then((s) => useSessionStore.getState().hydrate(s))

    const offStatus = orca.onSessionStatus((e) =>
      useSessionStore.getState().setStatus(e.sessionId, e.status)
    )
    const offExit = orca.onSessionExit((e) =>
      useSessionStore.getState().setStatus(e.sessionId, 'exited')
    )
    return () => {
      offStatus()
      offExit()
    }
  }, [])
}

function App(): React.JSX.Element {
  useBootstrap()
  const activeProject = useProjectStore(selectActiveProject)
  const setTree = useLayoutStore((s) => s.setTree)

  // Load the active project's saved layout when it changes.
  useEffect(() => {
    setTree(activeProject?.layout ?? null)
  }, [activeProject?.id, setTree])

  return (
    <div className="flex h-screen w-screen bg-neutral-950 text-neutral-200">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-800">
        <ProjectList />
        <div className="mt-2 border-t border-neutral-800">
          <DashboardView />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <ViewTabs />
        <div className="min-h-0 flex-1 p-2">
          <WorkspaceView />
        </div>
      </main>
    </div>
  )
}

export default App
