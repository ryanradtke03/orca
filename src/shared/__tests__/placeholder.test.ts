import { describe, expect, it } from 'vitest'
import { getPlaceholderMessage } from '../placeholder'

describe('getPlaceholderMessage', () => {
  it('returns the scaffold placeholder text shown in the renderer', () => {
    expect(getPlaceholderMessage()).toBe('Orca scaffold is running.')
  })
})
