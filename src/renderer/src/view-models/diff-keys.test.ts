import { describe, expect, it } from 'vitest'
import { clampHunk, isEditableTarget, stepHunk } from './diff-keys'

describe('clampHunk', () => {
  it('leaves an in-range index untouched', () => {
    expect(clampHunk(1, 3)).toBe(1)
  })

  it('clamps below the first hunk', () => {
    expect(clampHunk(-1, 3)).toBe(0)
  })

  it('clamps past the last hunk', () => {
    expect(clampHunk(5, 3)).toBe(2)
  })

  it('collapses to 0 for a file with no hunks', () => {
    expect(clampHunk(0, 0)).toBe(0)
    expect(clampHunk(3, 0)).toBe(0)
  })
})

describe('stepHunk', () => {
  it('advances to the next hunk', () => {
    expect(stepHunk(0, 3, 1)).toBe(1)
  })

  it('goes back to the previous hunk', () => {
    expect(stepHunk(2, 3, -1)).toBe(1)
  })

  it('stays on the last hunk instead of wrapping', () => {
    expect(stepHunk(2, 3, 1)).toBe(2)
  })

  it('stays on the first hunk instead of wrapping', () => {
    expect(stepHunk(0, 3, -1)).toBe(0)
  })
})

describe('isEditableTarget', () => {
  it('is false for a null target', () => {
    expect(isEditableTarget(null)).toBe(false)
  })

  it('is true for text inputs, textareas and selects', () => {
    expect(isEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true)
  })

  it('is true for a contenteditable region', () => {
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true)
  })

  it('is false for a plain non-editable element', () => {
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: false } as unknown as EventTarget)).toBe(false)
    expect(isEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false)
  })
})
