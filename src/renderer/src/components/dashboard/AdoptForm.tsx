import { useState } from 'react'

export function AdoptForm({
  onAdopt
}: {
  onAdopt: (pid: number, directory: string) => Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pid, setPid] = useState('')
  const [directory, setDirectory] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    const trimmedPid = pid.trim()
    const trimmedDirectory = directory.trim()
    const parsedPid = Number(trimmedPid)
    if (!trimmedPid || !Number.isInteger(parsedPid) || parsedPid <= 0 || !trimmedDirectory) {
      setError('Enter a valid PID and working directory to adopt.')
      return
    }

    try {
      await onAdopt(parsedPid, trimmedDirectory)
      setOpen(false)
      setPid('')
      setDirectory('')
      setError('')
    } catch {
      // Parent already surfaces the failure message; keep the form open with
      // whatever the user typed so they can fix and retry.
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        className="w-full rounded-[6px] px-3 py-2 text-center text-[11.5px] font-normal text-tertiary hover:text-primary"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Cancel adopt' : 'Adopt session…'}
      </button>

      {open && (
        <form onSubmit={(event) => void handleSubmit(event)} className="mt-1.5 flex flex-col gap-1.5">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            className="field-input w-full"
            placeholder="PID"
            autoComplete="off"
            required
            value={pid}
            onChange={(event) => setPid(event.target.value)}
          />
          <input
            type="text"
            className="field-input w-full"
            placeholder="Working directory"
            autoComplete="off"
            required
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
          />
          <button type="submit" className="btn">
            Adopt
          </button>
          {error && (
            <p role="alert" className="m-0 text-[11px] leading-snug text-danger">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
