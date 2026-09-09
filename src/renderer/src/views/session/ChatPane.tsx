import type { TranscriptMessage } from '../../../../shared/ipc-contract'
import { permissionResponse } from '../../view-models/prompt-view'
import {
  toolNameFromCommand,
  type PermissionCardEntry,
  type ToolCallEntry,
  type TranscriptEntry
} from '../../view-models/transcript'

function UserBubble({ message }: { message: TranscriptMessage }): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-lg bg-primary px-3.5 py-2.5 text-[13px] leading-relaxed text-app">
        {message.text}
      </div>
    </div>
  )
}

function AssistantMessage({ message }: { message: TranscriptMessage }): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-border-medium font-mono text-[10px] text-tertiary">
        cc
      </span>
      <div className="max-w-[78%] pt-1 text-[13px] leading-relaxed text-secondary">{message.text}</div>
    </div>
  )
}

function ToolCallChip({ entry }: { entry: ToolCallEntry }): React.JSX.Element {
  const glyph = entry.state === 'blocked' ? '!' : entry.state === 'running' ? '…' : '✓'
  const hasStats = entry.additions !== undefined || entry.deletions !== undefined
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border-faint bg-white/[0.02] px-3.5 py-2.5">
      <span className={`flex-none font-mono text-[12px] ${entry.state === 'blocked' ? 'text-faint' : 'text-tertiary'}`}>
        {glyph}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-secondary">{entry.label}</span>
      {entry.state === 'blocked' ? (
        <span className="flex-none text-[10.5px] text-faint">blocked</span>
      ) : (
        hasStats && (
          <span className="flex-none font-mono text-[10.5px] text-tertiary">
            +{entry.additions ?? 0} −{entry.deletions ?? 0}
          </span>
        )
      )}
    </div>
  )
}

/**
 * The in-thread permission card. Its three responses (Approve once / Always
 * allow / Deny) answer the prompt against the engine via `respondToPrompt`
 * (#60), each sending the digit that selects its TUI option (see prompt-view).
 */
function PermissionCard({
  entry,
  onRespond
}: {
  entry: PermissionCardEntry
  onRespond: (response: string) => void
}): React.JSX.Element {
  const toolName = toolNameFromCommand(entry.command)
  return (
    <div className="rounded-lg border border-border-medium bg-panel px-4 py-4">
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-center gap-2.5">
          <span className="h-[7px] w-[7px] flex-none rotate-45 bg-accent" />
          <span className="text-[9.5px] leading-none font-medium tracking-[0.12em] text-primary uppercase">
            Permission required
          </span>
        </div>
        {entry.waitingFor && <span className="font-mono text-[10.5px] text-faint">{entry.waitingFor}</span>}
      </div>
      <div className="rounded-md border border-border-faint bg-app px-4 py-3 font-mono text-[13px] text-primary">
        {entry.command}
      </div>
      <p className="mt-3 mb-4 text-[12px] leading-relaxed text-secondary">{entry.detail}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => onRespond(permissionResponse('approve-once'))}>
          Approve once · ⏎
        </button>
        <button type="button" className="btn-ghost" onClick={() => onRespond(permissionResponse('always-allow'))}>
          Always allow{toolName ? ` ${toolName}` : ''}
        </button>
        <button type="button" className="btn-ghost" onClick={() => onRespond(permissionResponse('deny'))}>
          Deny · esc
        </button>
      </div>
    </div>
  )
}

function TranscriptEntryView({
  entry,
  onRespond
}: {
  entry: TranscriptEntry
  onRespond: (response: string) => void
}): React.JSX.Element {
  if (entry.kind === 'message') {
    return entry.message.role === 'user' ? (
      <UserBubble message={entry.message} />
    ) : (
      <AssistantMessage message={entry.message} />
    )
  }
  if (entry.kind === 'tool-call') return <ToolCallChip entry={entry} />
  return <PermissionCard entry={entry} onRespond={onRespond} />
}

export function ChatPane({
  entries,
  onRespond
}: {
  entries: TranscriptEntry[]
  /** Answers an in-thread permission card - the response string selects its TUI option. */
  onRespond: (response: string) => void
}): React.JSX.Element {
  return (
    <div id="session-chat" className="flex-1 overflow-y-auto px-6 py-6">
      {entries.length === 0 ? (
        <div className="py-10 text-[12.5px] leading-relaxed text-faint">No messages yet.</div>
      ) : (
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          {entries.map((entry) => (
            <TranscriptEntryView
              key={entry.kind === 'message' ? entry.message.id : entry.id}
              entry={entry}
              onRespond={onRespond}
            />
          ))}
        </div>
      )}
    </div>
  )
}
