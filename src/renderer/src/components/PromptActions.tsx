import { resolvePermissionResponses } from '../../../shared/prompt-options'
import type { PendingPrompt } from '../../../shared/ipc-contract'

export function PromptActions({
  prompt,
  onRespond
}: {
  prompt: PendingPrompt
  onRespond: (response: string) => Promise<void>
}): React.JSX.Element {
  const { approve, deny } = resolvePermissionResponses(prompt.text)

  // Failure is already surfaced via the shared status message (App.tsx) -
  // just avoid an unhandled promise rejection here.
  function respond(response: string): void {
    onRespond(response).catch(() => {})
  }

  return (
    <div className="flex gap-[7px]">
      <button type="button" className="btn-ghost" onClick={() => respond(deny)}>
        Deny
      </button>
      <button type="button" className="btn" onClick={() => respond(approve)}>
        Approve
      </button>
    </div>
  )
}
