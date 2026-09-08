/**
 * The session composer. Every control here is inert for now (ticket #51) - the
 * screen is the 05b visual foundation; wiring @file / command insertion, plan
 * mode, the prompt queue, and Send to the engine is a later ticket.
 */
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

export function Composer({ queuedCount = 0 }: { queuedCount?: number }): React.JSX.Element {
  return (
    <div className="border-t border-border-soft px-6 py-4">
      <div className="rounded-lg border border-border-medium bg-white/4 px-4 py-3.5">
        <div className="min-h-[24px] text-[12.5px] leading-relaxed text-faint">
          Reply, or ⌘⏎ to queue while Claude waits…
        </div>
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
            <button type="button" className="btn">
              Send · ⌘⏎
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
