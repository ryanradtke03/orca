import type { DropZone } from '@shared/layout'

/**
 * Which drop zone a pointer is in, relative to a pane's rect.
 * Outer quarters split; the center swaps. Pure — trivially unit-testable.
 */
export function computeDropZone(rect: DOMRect, clientX: number, clientY: number): DropZone {
  const x = (clientX - rect.left) / rect.width
  const y = (clientY - rect.top) / rect.height
  const EDGE = 0.25

  if (x < EDGE) return 'left'
  if (x > 1 - EDGE) return 'right'
  if (y < EDGE) return 'top'
  if (y > 1 - EDGE) return 'bottom'
  return 'center'
}
