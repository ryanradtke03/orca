import { useEffect, useState } from 'react'
import type { Session } from '../../../shared/ipc-contract'
import { describeError } from '../describe-error'
import { removalDiscardsWorktree } from '../view-models/session'

/**
 * Confirms removing a Session before the (potentially destructive) engine call
 * runs. Removal always drops the Session from every list; when its worktree is
 * still on disk it also discards that worktree - and if the Session is still
 * live, stops the process first. The copy spells out whichever of those
 * applies so the user isn't surprised by what "Remove" throws away.
 *
 * `onConfirm` performs the actual removal (call + optimistic drop) and rejects
 * on failure; this component owns only the confirmation and error display,
 * staying open on any error and closing once the removal resolves.
 */
export function RemoveSessionModal({
  session,
  projectName,
  onConfirm,
  onClose
}: {
  session: Session
  projectName: string
  onConfirm: (sessionId: string) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const discardsWorktree = removalDiscardsWorktree(session)

  // Esc closes the modal, matching the usual dialog affordance - but not while
  // a removal is in flight, so the dialog can't unmount mid-request (which
  // would strip the inline error and setState on an unmounted component). Cancel
  // and the backdrop are disabled for the same reason.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, submitting])

  async function handleConfirm(): Promise<void> {
    setSubmitting(true)
    setError('')
    try {
      await onConfirm(session.id)
      onClose()
    } catch (caught) {
      setError(describeError(caught))
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6"
      onClick={submitting ? undefined : onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-[420px] rounded-[9px] border border-border-soft bg-panel p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Remove session"
      >
        <h2 className="m-0 text-[15px] leading-none font-semibold tracking-[-0.01em] text-primary">
          Remove session?
        </h2>
        <p className="mt-2.5 text-[12px] leading-relaxed text-secondary">
          <span className="font-mono text-primary">
            {projectName}/{session.branch}
          </span>{' '}
          will be removed from Orca and no longer appear in any list.
        </p>
        {discardsWorktree ? (
          <p className="mt-2.5 text-[12px] leading-relaxed text-danger">
            Its worktree will be deleted from disk, including any uncommitted or unmerged changes. This cannot be
            undone.
          </p>
        ) : (
          <p className="mt-2.5 text-[12px] leading-relaxed text-secondary">
            Its worktree is already gone, so nothing on disk is affected.
          </p>
        )}

        {error && <div className="mt-3 text-[11.5px] leading-relaxed text-danger">{error}</div>}

        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={() => void handleConfirm()} disabled={submitting}>
            {submitting ? 'Removing…' : 'Remove session'}
          </button>
        </div>
      </div>
    </div>
  )
}
