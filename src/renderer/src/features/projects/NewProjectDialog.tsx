import { useState } from 'react'
import type { Project } from '@shared/domain'
import { orca } from '@renderer/lib/ipc'
import { useProjectStore } from '@renderer/store/projects'

/** Minimal inline form to add a project (name + absolute path). */
export function NewProjectDialog({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const upsert = useProjectStore((s) => s.upsert)
  const setActive = useProjectStore((s) => s.setActive)

  async function create(): Promise<void> {
    if (!name.trim() || !path.trim()) return
    const project: Project = { id: crypto.randomUUID(), name, path, layout: null }
    await orca.saveProject(project)
    upsert(project)
    setActive(project.id)
    onDone()
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 outline-none"
      />
      <input
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/absolute/path"
        className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 outline-none"
      />
      <div className="flex gap-1">
        <button onClick={create} className="rounded bg-blue-600 px-2 py-1 text-xs text-white">
          Create
        </button>
        <button onClick={onDone} className="rounded px-2 py-1 text-xs text-neutral-400">
          Cancel
        </button>
      </div>
    </div>
  )
}
