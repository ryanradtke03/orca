export interface AdoptInput {
  pid: number
  directory: string
}

export type AdoptParseResult = { ok: true; value: AdoptInput } | { ok: false; error: string }

/**
 * Validates and normalizes the two raw text fields the Adopt form collects
 * before they reach `orca.adoptSession(pid, directory)`. Keeps the guaranteed
 * failures (empty / non-numeric input) out of the engine round-trip; the
 * engine still owns the real ones (unknown pid, already tracked), which surface
 * as thrown errors. Returns the parsed `pid`/`directory` on success, or a
 * single human-readable message on the first problem found.
 */
export function parseAdoptInput(pidRaw: string, directoryRaw: string): AdoptParseResult {
  const directory = directoryRaw.trim()
  if (directory === '') return { ok: false, error: 'Working directory is required.' }

  const pidText = pidRaw.trim()
  if (pidText === '') return { ok: false, error: 'PID is required.' }
  // Digits only - rejects a negative sign, decimal point, whitespace, or an
  // exponent before Number() would quietly coerce them.
  if (!/^\d+$/.test(pidText)) return { ok: false, error: 'PID must be a whole number.' }

  const pid = Number(pidText)
  if (!Number.isInteger(pid) || pid <= 0) return { ok: false, error: 'PID must be a positive number.' }

  return { ok: true, value: { pid, directory } }
}
