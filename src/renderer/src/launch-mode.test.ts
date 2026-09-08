import { describe, expect, it } from 'vitest'
import { resolveLaunchMode } from './launch-mode'

describe('resolveLaunchMode', () => {
  it('is live when neither flag is set', () => {
    expect(resolveLaunchMode({ mock: false, demo: false })).toBe('live')
  })

  it('is mock when the mock flag is set', () => {
    expect(resolveLaunchMode({ mock: true, demo: false })).toBe('mock')
  })

  it('is demo when only the demo flag is set', () => {
    expect(resolveLaunchMode({ mock: false, demo: true })).toBe('demo')
  })

  it('prefers mock over demo - the mock bridge is what actually runs', () => {
    expect(resolveLaunchMode({ mock: true, demo: true })).toBe('mock')
  })
})
