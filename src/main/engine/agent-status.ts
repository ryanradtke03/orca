import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PendingPromptType } from '../../shared/ipc-contract'

const execFileAsync = promisify(execFile)

// Shape of one entry in `claude agents --json --all`'s output. The CLI's own
// background-session registry, not something Orca maintains itself.
export interface AgentStatusEntry {
  id?: string
  pid?: number
  status?: string
  waitingFor?: string
  state?: string
}

export type ListAgentStatuses = () => Promise<AgentStatusEntry[]>

// `args` defaults to the real subcommand, but is overridable so tests can
// point `command` at a stand-in binary (e.g. `node -e <script>`) without
// that stand-in needing to accept and ignore `agents --json --all`.
export function createAgentStatusLister(command = 'claude', args = ['agents', '--json', '--all']): ListAgentStatuses {
  return async function listAgentStatuses(): Promise<AgentStatusEntry[]> {
    try {
      const { stdout } = await execFileAsync(command, args)
      return JSON.parse(stdout) as AgentStatusEntry[]
    } catch {
      // Transient failure (CLI busy, momentarily unreachable, bad output) -
      // callers treat this the same as "nothing to report" for that tick.
      return []
    }
  }
}

/**
 * A background session only exposes a `waitingFor` category, not the CLI's
 * own rendered prompt text - the literal text still has to come from
 * `claude logs` (see prompt-text.ts). This just classifies what kind of
 * prompt is pending, if any.
 */
export function promptTypeFromStatus(entry: AgentStatusEntry | undefined): PendingPromptType | null {
  if (!entry || entry.status !== 'waiting') return null
  return entry.waitingFor === 'permission prompt' ? 'permission' : 'input'
}
