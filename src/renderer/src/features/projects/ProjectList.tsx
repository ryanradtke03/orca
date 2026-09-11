import { useState } from 'react'
import { useProjectStore } from '@renderer/store/projects'
import { NewProjectDialog } from './NewProjectDialog'

/** Sidebar list of projects; selecting one makes it active. */
export function ProjectList(): React.JSX.Element {
  const { projects, activeProjectId, setActive } = useProjectStore()
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-2 py-1 text-xs font-semibold text-neutral-400">
        <span>Projects</span>
        <button onClick={() => setAdding((v) => !v)} className="text-neutral-500 hover:text-white">
          +
        </button>
      </div>

      {adding && <NewProjectDialog onDone={() => setAdding(false)} />}

      <ul className="flex flex-col">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => setActive(p.id)}
              className={`w-full truncate px-2 py-1 text-left text-xs ${
                p.id === activeProjectId
                  ? 'bg-neutral-800 text-white'
                  : 'text-neutral-400 hover:bg-neutral-900'
              }`}
            >
              {p.name}
            </button>
          </li>
        ))}
        {projects.length === 0 && !adding && (
          <li className="px-2 py-1 text-xs text-neutral-600">No projects — add one</li>
        )}
      </ul>
    </div>
  )
}
