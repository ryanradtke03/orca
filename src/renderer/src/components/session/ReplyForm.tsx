import { useState } from 'react'
import { describeError } from '../../describe-error'

export function ReplyForm({ onSubmit }: { onSubmit: (message: string) => Promise<void> }): React.JSX.Element {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    const message = value.trim()
    // `required` blocks a fully empty submit; this catches the whitespace-only
    // case it can't, so the user still sees why nothing was sent.
    if (!message) {
      setError('Message cannot be blank.')
      return
    }

    try {
      await onSubmit(message)
      setValue('')
      setError('')
    } catch (submitError) {
      // Leave the typed message in place so a failed send doesn't lose it.
      setError(describeError(submitError))
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-none flex-col gap-1.5">
      <div className="flex items-center gap-[7px]">
        <input
          type="text"
          className="field-input w-[220px]"
          placeholder="Type a message…"
          autoComplete="off"
          required
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError('')
          }}
        />
        <button type="submit" className="btn">
          Send
        </button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[11px] leading-snug text-danger">
          {error}
        </p>
      )}
    </form>
  )
}
