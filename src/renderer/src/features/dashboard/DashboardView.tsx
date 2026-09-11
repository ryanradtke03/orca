import { useSessionStore, selectSessionList } from '@renderer/store/sessions'
import { useProjectStore, selectActiveProject } from '@renderer/store/projects'
import { useViewStore, viewPredicate } from '@renderer/store/views'
import { spawnSession } from '@renderer/lib/actions'

/** Filtered session list for the active view + a spawn button. */
export function DashboardView(): React.JSX.Element {
  const sessions = useSessionStore(selectSessionList)
  const view = useViewStore((s) => s.view)
  const activeProject = useProjectStore(selectActiveProject)
  const activeProjectId = activeProject?.id ?? null

  const visible = sessions.filter(viewPredicate(view, { activeProjectId }))

  return (
    <div className="flex flex-col gap-2 p-2">
      <button
        disabled={!activeProject}
        onClick={() =>
          activeProject &&
          spawnSession({ projectId: activeProject.id, cwd: activeProject.path })
        }
        className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-40"
      >
        + New session
      </button>

      <ul className="flex flex-col gap-1">
        {visible.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between rounded bg-neutral-900 px-2 py-1 text-xs text-neutral-300"
          >
            <span className="truncate">{s.title}</span>
            <span className="text-neutral-500">{s.status}</span>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="px-2 py-1 text-xs text-neutral-600">No sessions</li>
        )}
      </ul>
    </div>
  )
}
