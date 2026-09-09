import { describe, expect, it } from 'vitest'
import { PERMISSION_RESPONSE, permissionResponse } from './prompt-view'

describe('permissionResponse', () => {
  it('maps each permission action to the digit that selects its TUI option', () => {
    // "1. Yes" / "2. Yes, and don't ask again" / "3. No" in Claude Code's
    // permission dialog - guard against an accidental reshuffle that would
    // silently answer the wrong option.
    expect(permissionResponse('approve-once')).toBe('1')
    expect(permissionResponse('always-allow')).toBe('2')
    expect(permissionResponse('deny')).toBe('3')
  })

  it('covers every action in the map', () => {
    expect(Object.keys(PERMISSION_RESPONSE)).toEqual(['approve-once', 'always-allow', 'deny'])
  })
})
