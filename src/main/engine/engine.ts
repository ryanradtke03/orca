import { randomUUID } from 'crypto'
import { basename } from 'path'
import type { PingResult, Project } from '../../shared/ipc-contract'
import type { EngineAdapters } from './adapters'

export interface Engine {
  ping(): Promise<PingResult>
  listProjects(): Promise<Project[]>
  addProject(path: string): Promise<Project>
}

export function createEngine(adapters: EngineAdapters): Engine {
  let projects: Project[] | undefined
  // Serializes addProject calls so a concurrent read-modify-write can't drop a write.
  let writeQueue: Promise<unknown> = Promise.resolve()

  async function loadProjects(): Promise<Project[]> {
    if (!projects) {
      projects = await adapters.persistence.loadProjects()
    }
    return projects
  }

  function addProject(path: string): Promise<Project> {
    const result = writeQueue.then(async () => {
      const existing = await loadProjects()
      const project: Project = { id: randomUUID(), path, name: basename(path) }

      projects = [...existing, project]
      await adapters.persistence.saveProjects(projects)

      return project
    })

    writeQueue = result.catch(() => {})
    return result
  }

  return {
    async ping() {
      const sessionCount = await adapters.persistence.loadSessionCount()
      return { ok: true, sessionCount }
    },
    async listProjects() {
      return loadProjects()
    },
    addProject
  }
}
