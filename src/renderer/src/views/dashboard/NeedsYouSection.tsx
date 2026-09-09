import { describeNeedsYou, type HomeSession } from '../../view-models/session'
import { permissionResponse } from '../../view-models/prompt-view'
import { StatusMarker } from '../../components/StatusMarker'

/**
 * A "Needs you" card's inline actions answer the prompt in place (#60):
 * Approve/Deny send a permission response via `respondToPrompt`, while Reply
 * opens the session so the answer can be typed in its composer. They
 * stopPropagation so a click answers the card rather than falling through to
 * the row's own navigation.
 */
function CardActions({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-none items-center gap-2" onClick={(event) => event.stopPropagation()}>
      {children}
    </div>
  )
}

function NeedsYouRow({
  session,
  projectName,
  onOpen,
  onRespond
}: {
  session: HomeSession
  projectName: string
  onOpen: (sessionId: string) => void
  onRespond: (sessionId: string, response: string) => void
}): React.JSX.Element {
  const summary = describeNeedsYou(session)

  return (
    <div
      className="flex cursor-pointer items-center gap-3.5 border-b border-white/14 px-4 py-3.5 last:border-b-0 hover:bg-hover"
      onClick={() => onOpen(session.id)}
    >
      <div className="flex-none">
        <StatusMarker status={session.status} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[12.5px] font-medium text-primary">
          {projectName}/{session.branch}
        </div>
        <div className="mt-1.5 text-[11.5px] leading-snug text-secondary">
          {summary.kind === 'permission' ? (
            <>
              Wants to run{' '}
              <code className="rounded-[4px] bg-white/8 px-1.5 py-0.5 font-mono text-[11px] text-primary">
                {summary.command}
              </code>{' '}
              in the worktree
            </>
          ) : (
            summary.text
          )}
        </div>
      </div>
      <CardActions>
        {summary.kind === 'permission' ? (
          <>
            <button type="button" className="btn-ghost" onClick={() => onRespond(session.id, permissionResponse('deny'))}>
              Deny
            </button>
            <button type="button" className="btn" onClick={() => onRespond(session.id, permissionResponse('approve-once'))}>
              Approve
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => onOpen(session.id)}>
            Reply
          </button>
        )}
      </CardActions>
    </div>
  )
}

export function NeedsYouSection({
  attention,
  projectNameFor,
  onOpen,
  onRespond
}: {
  attention: HomeSession[]
  projectNameFor: (projectId: string) => string
  onOpen: (sessionId: string) => void
  onRespond: (sessionId: string, response: string) => void
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
          <NeedsYouRow
            key={session.id}
            session={session}
            projectName={projectNameFor(session.projectId)}
            onOpen={onOpen}
            onRespond={onRespond}
          />
        ))}
      </div>
    </div>
  )
}
