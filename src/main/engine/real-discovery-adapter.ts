import { execFile } from 'child_process'
import type { Dirent } from 'fs'
import { open, readdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type { PendingPrompt, PendingPromptType, SessionStatus } from '../../shared/ipc-contract'
import type { DiscoveredSession, DiscoveryAdapter } from './adapters'
import {
  createAgentStatusLister,
  promptTypeFromStatus,
  type AgentStatusEntry,
  type ListAgentStatuses
} from './agent-status'
import { extractPromptText, renderScreen } from './prompt-text'

const execFileAsync = promisify(execFile)

// Claude Code writes one transcript file per session, named by the CLI's own
// session id, under a directory tree rooted here - the only place a
// session's working directory can be recovered from, since `claude agents
// --json --all` reports id/pid/status but not cwd (see agent-status.ts).
const DEFAULT_TRANSCRIPTS_ROOT_DIR = join(homedir(), '.claude', 'projects')

// Tried in order against the Project root to find something to diff a
// discovered session's branch against. There's no recorded fork point for a
// session Orca didn't spawn itself (unlike createWorktree's baseRef), so
// this is a best-effort default, not a guarantee of the true merge base.
const DEFAULT_BRANCH_CANDIDATES = ['main', 'master']

// Walked once per scan() call and shared across every entry that scan
// resolves, rather than re-walking the whole transcripts tree per session -
// with N concurrently running sessions a per-entry walk would cost N full
// tree walks every poll tick for the same, mostly-unchanged directory.
async function buildTranscriptIndex(rootDir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>()

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(entryPath)
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          index.set(entry.name.slice(0, -'.jsonl'.length), entryPath)
        }
      })
    )
  }

  await walk(rootDir)
  return index
}

// A transcript's cwd lives in the first line's metadata, but a long-running
// session's transcript can grow to many MB - reads only a bounded prefix
// instead of the whole file. Real transcript metadata lines are tiny, so a
// first line that doesn't fit in this prefix is treated as unresolvable
// rather than growing the read further.
const TRANSCRIPT_CWD_READ_BYTES = 8192

async function readTranscriptCwd(transcriptPath: string): Promise<string | null> {
  let handle
  try {
    handle = await open(transcriptPath, 'r')
    const buffer = Buffer.alloc(TRANSCRIPT_CWD_READ_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, TRANSCRIPT_CWD_READ_BYTES, 0)
    const chunk = buffer.toString('utf-8', 0, bytesRead)

    const newlineIndex = chunk.indexOf('\n')
    const firstLine = newlineIndex === -1 ? chunk : chunk.slice(0, newlineIndex)
    if (!firstLine.trim()) return null

    const parsed = JSON.parse(firstLine) as { cwd?: string }
    return typeof parsed.cwd === 'string' ? parsed.cwd : null
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

async function resolveProjectPath(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd })
    return stdout.trim()
  } catch {
    // Not inside a git repo - outside Orca's Project model entirely.
    return null
  }
}

async function resolveBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function resolveBaseRef(cwd: string): Promise<string> {
  for (const candidate of DEFAULT_BRANCH_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync('git', ['merge-base', 'HEAD', candidate], { cwd })
      return stdout.trim()
    } catch {
      continue
    }
  }

  // No recognizable default branch to diff against - fall back to the
  // session's current HEAD, so getDiff at least shows whatever changes are
  // made from here on, even if it misses history before discovery.
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })
    return stdout.trim()
  } catch {
    return ''
  }
}

function classify(entry: AgentStatusEntry): { status: SessionStatus; promptType: PendingPromptType | null } {
  const promptType = promptTypeFromStatus(entry)
  if (promptType) {
    return {
      status: promptType === 'permission' ? 'waiting-on-permission' : 'waiting-on-input',
      promptType
    }
  }
  return { status: entry.status === 'idle' ? 'idle' : 'running', promptType: null }
}

async function resolvePendingPrompt(
  command: string,
  sessionId: string,
  promptType: PendingPromptType
): Promise<PendingPrompt | undefined> {
  try {
    const { stdout } = await execFileAsync(command, ['logs', sessionId])
    const lines = await renderScreen(stdout)
    const text = extractPromptText(lines)
    return text ? { type: promptType, text } : undefined
  } catch {
    // A transient `claude logs` failure just means this scan reports the
    // session without prompt text yet - a later scan can still fill it in.
    return undefined
  }
}

export function createRealDiscoveryAdapter(
  command = 'claude',
  transcriptsRootDir = DEFAULT_TRANSCRIPTS_ROOT_DIR,
  listAgentStatuses: ListAgentStatuses = createAgentStatusLister(command)
): DiscoveryAdapter {
  return {
    async scan(): Promise<DiscoveredSession[]> {
      let statuses: AgentStatusEntry[]
      try {
        statuses = await listAgentStatuses()
      } catch {
        // Transient failure listing sessions - report nothing found rather
        // than throwing, so one flaky `claude agents` call doesn't stop the
        // rest of Orca's periodic work (the caller just tries again later).
        return []
      }

      const transcriptIndex = await buildTranscriptIndex(transcriptsRootDir)

      const resolved = await Promise.all(
        statuses.map(async (entry): Promise<DiscoveredSession | null> => {
          // No pid means the CLI's background service no longer considers
          // this session running (finished, crashed, or never started) -
          // Discovery only surfaces sessions that are actually alive.
          if (entry.id === undefined || entry.pid === undefined) return null

          const transcriptPath = transcriptIndex.get(entry.id)
          const cwd = transcriptPath ? await readTranscriptCwd(transcriptPath) : null
          if (!cwd) return null

          const projectPath = await resolveProjectPath(cwd)
          if (!projectPath) return null

          const [branch, baseRef] = await Promise.all([resolveBranch(cwd), resolveBaseRef(cwd)])
          const { status, promptType } = classify(entry)
          const pendingPrompt = promptType
            ? await resolvePendingPrompt(command, entry.id, promptType)
            : undefined

          return { pid: entry.pid, cwd, projectPath, branch, baseRef, status, pendingPrompt }
        })
      )

      return resolved.filter((entry): entry is DiscoveredSession => entry !== null)
    },

    async resolveManual(pid: number, directory: string): Promise<DiscoveredSession | null> {
      let statuses: AgentStatusEntry[]
      try {
        statuses = await listAgentStatuses()
      } catch {
        return null
      }

      const entry = statuses.find((candidate) => candidate.pid === pid)
      if (!entry || entry.id === undefined) return null

      const projectPath = await resolveProjectPath(directory)
      if (!projectPath) return null

      const [branch, baseRef] = await Promise.all([resolveBranch(directory), resolveBaseRef(directory)])
      const { status, promptType } = classify(entry)
      const pendingPrompt = promptType
        ? await resolvePendingPrompt(command, entry.id, promptType)
        : undefined

      return { pid, cwd: directory, projectPath, branch, baseRef, status, pendingPrompt }
    }
  }
}
