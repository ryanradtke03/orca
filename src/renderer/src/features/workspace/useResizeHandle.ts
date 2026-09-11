import { useCallback } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { SplitAxis } from '@shared/layout'
import { useLayoutStore } from '@renderer/store/layout'

/**
 * Divider drag: adjust the two ratios on either side of handle `index` as the
 * pointer moves along the split's axis. Mirrors the reference's resizeDragState.
 */
export function useResizeHandle(
  splitId: string,
  containerRef: RefObject<HTMLDivElement | null>,
  axis: SplitAxis,
  sizes: number[]
): (e: ReactPointerEvent, index: number) => void {
  const resize = useLayoutStore((s) => s.resize)

  return useCallback(
    (e: ReactPointerEvent, index: number) => {
      e.preventDefault()
      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      const isRow = axis === 'row'
      const total = isRow ? rect.width : rect.height
      const startPos = isRow ? e.clientX : e.clientY
      const startSizes = [...sizes]

      const onMove = (ev: PointerEvent): void => {
        const delta = ((isRow ? ev.clientX : ev.clientY) - startPos) / total
        const next = [...startSizes]
        next[index] = Math.max(0.05, startSizes[index] + delta)
        next[index + 1] = Math.max(0.05, startSizes[index + 1] - delta)
        resize(splitId, next)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [splitId, containerRef, axis, sizes, resize]
  )
}
