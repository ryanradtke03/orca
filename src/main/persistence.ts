import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import type { Project, LayoutPreset } from '@shared/domain'

/**
 * Flat-file JSON persistence in the app's userData dir. Projects and presets
 * are the durable state (sessions are ephemeral and never persisted).
 * Swap for SQLite later if this grows.
 */
const dataDir = (): string => join(app.getPath('userData'), 'orca')
const projectsFile = (): string => join(dataDir(), 'projects.json')
const presetsFile = (): string => join(dataDir(), 'presets.json')

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dataDir(), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2), 'utf-8')
}

export async function loadProjects(): Promise<Project[]> {
  return readJson<Project[]>(projectsFile(), [])
}

export async function saveProject(project: Project): Promise<void> {
  const projects = await loadProjects()
  const idx = projects.findIndex((p) => p.id === project.id)
  if (idx >= 0) projects[idx] = project
  else projects.push(project)
  await writeJson(projectsFile(), projects)
}

export async function loadPresets(): Promise<LayoutPreset[]> {
  return readJson<LayoutPreset[]>(presetsFile(), [])
}

export async function savePresets(presets: LayoutPreset[]): Promise<void> {
  await writeJson(presetsFile(), presets)
}
