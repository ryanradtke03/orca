import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PendingPromptType } from '../../../shared/ipc-contract'

const execFileAsync = promisify(execFile)

// Shape of one entry in `claude agents --json --all`'s output. The CLI's own
// background-session registry, not something Orca maintains itself. The schema
// has drifted over CLI versions - the helpers below normalize across them so
// the adapters don't hard-code one shape:
//   - "waiting on the user" is now `state: "blocked"`; older builds used
//     `status: "waiting"` (+ `waitingFor`, which newer builds drop).
//   - a session's transcript file is named by its full `sessionId` (a UUID),
//     which is distinct from the short `id` the CLI shows and takes for
//     `logs` / `attach` / `stop`.
//   - `state` also carries the terminal outcome (`done` / `failed`).
export interface AgentStatusEntry {
  id?: string
  sessionId?: string
  pid?: number
  status?: string
  waitingFor?: string
  state?: string
}

// The terminal outcome the CLI reports for a session, as a process exit code -
// or null while it is still alive. `crashed` is an older synonym for `failed`.
export function terminalExitCode(entry: AgentStatusEntry | undefined): number | null {
  if (entry?.state === 'done') return 0
  if (entry?.state === 'failed' || entry?.state === 'crashed') return 1
  return null
}

// Whether a session is waiting on the user (a permission prompt or a clarifying
// question). Accepts both the current signal (`state: "blocked"`) and the older
// one (`status: "waiting"`) so the adapter works across CLI versions.
export function isWaitingOnUser(entry: AgentStatusEntry | undefined): boolean {
  return entry?.state === 'blocked' || entry?.status === 'waiting'
}

// The id under which a session's `.jsonl` transcript is filed. Prefer the full
// `sessionId` (the actual filename); fall back to the short `id` for older
// output that only carried that (readTranscript prefix-matches it).
export function transcriptSessionId(entry: AgentStatusEntry): string | undefined {
  return entry.sessionId ?? entry.id
}

// A permission dialog's rendered text carries tell-tale option lines ("…don't
// ask again", "No, and tell Claude what to do differently", "Do you want to
// proceed?") a plain clarifying question never does. Used to classify a waiting
// prompt when the CLI no longer tags its kind (`waitingFor` is gone); an
// explicit `waitingFor` still wins outright.
const PERMISSION_DIALOG = /don['’]t ask again|No, and tell Claude|Do you want to proceed/i

export function classifyPromptText(text: string, waitingFor?: string): PendingPromptType {
  if (waitingFor === 'permission prompt') return 'permission'
  if (waitingFor !== undefined) return 'input'
  return PERMISSION_DIALOG.test(text) ? 'permission' : 'input'
}

export type ListAgentStatuses = () => Promise<AgentStatusEntry[]>

// `args` defaults to the real subcommand, but is overridable so tests can
// point `command` at a stand-in binary (e.g. `node -e <script>`) without
// that stand-in needing to accept and ignore `agents --json --all`.
// Throws on any failure (CLI busy, momentarily unreachable, bad output)
// rather than swallowing to an empty list - an empty list is meaningfully
// different from "couldn't ask": callers that treated them the same used to
// read a transient failure as "every tracked session just vanished".
export function createAgentStatusLister(command = 'claude', args = ['agents', '--json', '--all']): ListAgentStatuses {
  return async function listAgentStatuses(): Promise<AgentStatusEntry[]> {
    const { stdout } = await execFileAsync(command, args)
    return JSON.parse(stdout) as AgentStatusEntry[]
  }
}
