import { randomUUID } from 'crypto'
import type { TranscriptMessage, TranscriptRole } from '../../../shared/ipc-contract'

// Claude Code writes one JSON object per line to a session's `.jsonl`
// transcript (under ~/.claude/projects/<encoded-cwd>/<cli-session-id>.jsonl).
// Only a few of those line `type`s are actual conversation turns; the rest are
// bookkeeping (mode, cost-state, file-history-snapshot, …) and are ignored.
//
// A conversation line looks like:
//   { "type": "user", "isSidechain": false, "timestamp": "2026-…Z",
//     "uuid": "…", "message": { "role": "user", "content": "…" } }
// where `content` is a plain string for a typed user prompt, or an array of
// parts for an assistant turn (and for tool results, which arrive as `user`
// lines). Each part carries its own `type`; only `text` parts hold prose we
// show - `thinking`, `tool_use`, and `tool_result` parts contribute nothing to
// the rendered transcript.

interface RawContentPart {
  type?: string
  text?: string
}

interface RawLine {
  type?: string
  uuid?: string
  timestamp?: string
  isSidechain?: boolean
  message?: {
    role?: string
    content?: string | RawContentPart[]
  }
}

const CONVERSATION_ROLES: ReadonlySet<string> = new Set<TranscriptRole>(['user', 'assistant'])

/**
 * Flattens a transcript line's `message.content` to the human-readable prose
 * the chat pane shows: a string turn is used as-is; an array turn keeps only
 * its `text` parts (dropping thinking/tool_use/tool_result), joined by blank
 * lines. Anything else yields an empty string, which the parser treats as a
 * non-conversational line and skips.
 */
export function extractMessageText(content: string | RawContentPart[] | undefined): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n\n')
    .trim()
}

/**
 * Parses a session's raw `.jsonl` transcript into the ordered
 * `TranscriptMessage[]` the IPC contract exposes. Skips every non-conversation
 * line, sub-agent sidechain turns (`isSidechain`), and turns whose visible
 * text is empty (a tool-call-only assistant turn or a tool-result user turn).
 * Malformed lines are tolerated and skipped rather than failing the whole read,
 * since a transcript can be appended to concurrently by the live CLI.
 */
export function parseTranscript(content: string): TranscriptMessage[] {
  const messages: TranscriptMessage[] = []

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    let parsed: RawLine
    try {
      parsed = JSON.parse(line) as RawLine
    } catch {
      continue
    }

    if (parsed.type !== 'user' && parsed.type !== 'assistant') continue
    if (parsed.isSidechain === true) continue

    const role = parsed.message?.role
    if (role === undefined || !CONVERSATION_ROLES.has(role)) continue

    const text = extractMessageText(parsed.message?.content)
    if (!text) continue

    const parsedTime = parsed.timestamp ? Date.parse(parsed.timestamp) : NaN

    messages.push({
      id: typeof parsed.uuid === 'string' ? parsed.uuid : randomUUID(),
      role: role as TranscriptRole,
      text,
      timestamp: Number.isFinite(parsedTime) ? parsedTime : 0
    })
  }

  return messages
}
