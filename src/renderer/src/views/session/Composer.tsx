/**
 * The session composer. Send is wired to the engine (#60): it messages an idle
 * session or answers a waiting-on-input prompt via `respondToPrompt`. The rest
 * of the controls stay inert for now - wiring @file / command insertion, plan
 * mode, and the ⌘⏎ prompt queue is a later ticket (#51).
 */
import { useState } from 'react'

function Chip({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      className="rounded-md border border-border-medium px-2.5 py-[5px] font-mono text-[10.5px] text-secondary hover:border-white/50 hover:text-primary"
    >
      {children}
    </button>
  )
}

export function Composer({
  queuedCount = 0,
  canSend,
  error,
  onSend
}: {
  queuedCount?: number
  /** Whether the session can receive a free-text message right now (idle / waiting-on-input). */
  canSend: boolean
  /** A failed send's message, surfaced under the box. */
  error?: string
  /** Sends the reply; resolves true once accepted, so the box clears only on success. */
  onSend: (text: string) => Promise<boolean>
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const trimmed = text.trim()
  const canSubmit = canSend && trimmed.length > 0 && !sending

  async function submit(): Promise<void> {
    if (!canSubmit) return
    setSending(true)
    try {
      if (await onSend(trimmed)) setText('')
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Plain Enter sends; Shift+Enter is a newline; ⌘/Ctrl+Enter is the (still
    // inert) queue gesture, so swallow it rather than sending.
    if (event.key !== 'Enter') return
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      return
    }
    if (!event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div className="border-t border-border-soft px-6 py-4">
      <div className="rounded-lg border border-border-medium bg-white/4 px-4 py-3.5">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Reply, or ⌘⏎ to queue while Claude waits…"
          className="min-h-[24px] w-full resize-none bg-transparent text-[12.5px] leading-relaxed text-primary placeholder:text-faint focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Chip>@ file</Chip>
            <Chip>/ command</Chip>
            <Chip>plan mode</Chip>
          </div>
          <div className="flex items-center gap-3">
            {queuedCount > 0 && (
              <span className="text-[11px] text-faint">
                {queuedCount} {queuedCount === 1 ? 'prompt' : 'prompts'} queued
              </span>
            )}
            <button
              type="button"
              className="btn disabled:pointer-events-none disabled:opacity-40"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              Send · ⌘⏎
            </button>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 mb-0 text-[11px] leading-snug text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
