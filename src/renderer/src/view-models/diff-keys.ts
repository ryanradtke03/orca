/**
 * Pure helpers for the diff screen's keyboard review flow (issue #72): moving
 * the viewport between hunks with j/k, and deciding when a single-key shortcut
 * should stand down because the user is typing. Kept out of the component so
 * the fiddly edge cases (clamping, the composer guard) are unit-testable.
 */

/** Clamp a hunk index to the valid range for a file with `count` hunks (0 when it has none). */
export function clampHunk(index: number, count: number): number {
  if (count <= 0) return 0
  if (index < 0) return 0
  if (index > count - 1) return count - 1
  return index
}

/** Step the active hunk by `delta`, clamping at the ends rather than wrapping. */
export function stepHunk(current: number, count: number, delta: number): number {
  return clampHunk(current + delta, count)
}

/** The shape the editable check reads off a keydown target - a real DOM element supplies both. */
interface EditableProbe {
  tagName?: string
  isContentEditable?: boolean
}

/**
 * Whether a keydown should be ignored because focus is in an editable element
 * (a text input, textarea, select, or contenteditable region - e.g. the
 * composer), so the diff's single-key shortcuts don't fire mid-typing.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as EditableProbe | null
  if (!el) return false
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  return el.isContentEditable === true
}
