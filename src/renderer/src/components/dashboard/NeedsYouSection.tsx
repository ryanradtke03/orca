import type { Session } from '../../../../shared/ipc-contract'
import { PromptText } from '../PromptText'
import { StatusMarker } from '../StatusMarker'

function NeedsYouRow({ session, onOpen }: { session: Session; onOpen: (sessionId: string) => void }): React.JSX.Element {
  const prompt = session.pendingPrompt
  if (!prompt) throw new Error(`NeedsYouRow rendered for session without a pending prompt: ${session.id}`)

  return (
    <div
      className="group flex cursor-pointer items-center gap-3.5 border-b border-white/14 px-4 py-3.5 last:border-b-0 hover:bg-hover"
      onClick={() => onOpen(session.id)}
    >
      <div className="flex-none">
        <StatusMarker status={session.status} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[12.5px] font-medium text-primary">{session.branch}</div>
        <PromptText
          text={prompt.text}
          className="mt-1.5 max-h-[130px] overflow-y-auto rounded-[5px] bg-white/3 px-2.5 py-2 text-[11px] text-secondary"
        />
      </div>
      <span className="flex-none text-[10.5px] font-medium text-faint group-hover:text-primary">Open →</span>
    </div>
  )
}

export function NeedsYouSection({
  attention,
  onOpen
}: {
  attention: Session[]
  onOpen: (sessionId: string) => void
}): React.JSX.Element | null {
  if (attention.length === 0) return null

  return (
    <div id="needs-you-section" className="px-6 pt-4">
      <div className="flex items-center gap-2.5 pb-1.5">
        <div className="h-[7px] w-[7px] flex-none rotate-45 bg-accent" />
        <span className="text-[9.5px] leading-none font-medium tracking-[0.12em] text-primary uppercase">Needs you</span>
        <div className="h-px flex-1 bg-border-medium" />
      </div>
      <div className="mt-2.5 overflow-hidden rounded-lg border border-border-strong bg-panel">
        {attention.map((session) => (
          <NeedsYouRow key={session.id} session={session} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}
