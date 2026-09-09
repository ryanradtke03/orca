import { useEffect, useState } from 'react'
import { describeError } from '../describe-error'
import { parseAdoptInput } from '../view-models/adopt'

/**
 * Collects the two inputs `orca.adoptSession(pid, directory)` needs and drives
 * the call. Empty/non-numeric input is caught locally (parseAdoptInput) before
 * the round-trip; the engine's real failures - "No running Claude Code session
 * found for pid …" and "Session already tracked: pid …" - come back as thrown
 * errors and are shown inline. The modal stays open on any error and closes
 * only once the adopt resolves.
 *
 * `onAdopt` performs the actual adopt (call + optimistic apply) and rejects on
 * failure; this component owns only the form, validation, and error display.
 */
export function AdoptSessionModal({
  onAdopt,
  onClose
}: {
  onAdopt: (pid: number, directory: string) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const [pid, setPid] = useState('')
  const [directory, setDirectory] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Esc closes the modal, matching the usual dialog affordance.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const parsed = parseAdoptInput(pid, directory)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onAdopt(parsed.value.pid, parsed.value.directory)
      onClose()
    } catch (caught) {
      setError(describeError(caught))
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6"
      onClick={onClose}
      role="presentation"
    >
      <form
        className="w-full max-w-[420px] rounded-[9px] border border-border-soft bg-panel p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void handleSubmit(event)}
        role="dialog"
        aria-modal="true"
        aria-label="Adopt a running session"
      >
        <h2 className="m-0 text-[15px] leading-none font-semibold tracking-[-0.01em] text-primary">
          Adopt a running session
        </h2>
        <p className="mt-2.5 text-[12px] leading-relaxed text-secondary">
          Point Orca at a Claude Code session already running outside it. Enter its process ID and the working
          directory it was launched in.
        </p>

        <label className="mt-4 block">
          <span className="label-heading">Process ID</span>
          <input
            className="field-input mt-2 w-full"
            value={pid}
            onChange={(event) => setPid(event.target.value)}
            placeholder="e.g. 48213"
            inputMode="numeric"
            autoFocus
          />
        </label>

        <label className="mt-3.5 block">
          <span className="label-heading">Working directory</span>
          <input
            className="field-input mt-2 w-full"
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            placeholder="e.g. ~/dev/my-repo"
          />
        </label>

        {error && <div className="mt-3 text-[11.5px] leading-relaxed text-danger">{error}</div>}

        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? 'Adopting…' : 'Adopt session'}
          </button>
        </div>
      </form>
    </div>
  )
}
