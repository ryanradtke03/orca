import { describe, expect, it } from 'vitest'
import { parseAdoptInput } from './adopt'

describe('parseAdoptInput', () => {
  it('accepts a positive integer pid and a directory, trimming both', () => {
    const result = parseAdoptInput('  4321 ', '  /work/repo  ')
    expect(result).toEqual({ ok: true, value: { pid: 4321, directory: '/work/repo' } })
  })

  it('rejects an empty directory first', () => {
    const result = parseAdoptInput('4321', '   ')
    expect(result).toEqual({ ok: false, error: 'Working directory is required.' })
  })

  it('rejects an empty pid', () => {
    expect(parseAdoptInput('  ', '/work/repo')).toEqual({ ok: false, error: 'PID is required.' })
  })

  it('rejects a non-numeric pid', () => {
    expect(parseAdoptInput('12a', '/work/repo')).toEqual({ ok: false, error: 'PID must be a whole number.' })
  })

  it('rejects a decimal or signed pid', () => {
    expect(parseAdoptInput('12.5', '/work/repo').ok).toBe(false)
    expect(parseAdoptInput('-4', '/work/repo').ok).toBe(false)
  })

  it('rejects a pid of zero', () => {
    expect(parseAdoptInput('0', '/work/repo')).toEqual({ ok: false, error: 'PID must be a positive number.' })
  })
})
