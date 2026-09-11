import { create } from 'zustand'
import type { Project } from '@shared/domain'

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  setProjects: (projects: Project[]) => void
  setActive: (id: string | null) => void
  upsert: (project: Project) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProjectId: null,
  setProjects: (projects) => set({ projects }),
  setActive: (activeProjectId) => set({ activeProjectId }),
  upsert: (project) =>
    set((s) => {
      const idx = s.projects.findIndex((p) => p.id === project.id)
      const projects = [...s.projects]
      if (idx >= 0) projects[idx] = project
      else projects.push(project)
      return { projects }
    })
}))

export const selectActiveProject = (s: ProjectState): Project | null =>
  s.projects.find((p) => p.id === s.activeProjectId) ?? null
