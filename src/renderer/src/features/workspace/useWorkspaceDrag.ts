import { create } from 'zustand'
import type { DropZone } from '@shared/layout'
import { useLayoutStore } from '@renderer/store/layout'
import { computeDropZone } from './dropZone'

/**
 * Native pointer-event drag state (no HTML5 draggable, no react-dnd).
 * A pane header calls `start`; panes call `updateOver` on pointer move; `drop`
 * commits the move/swap into the layout tree.
 */
interface DragState {
  draggingLeafId: string | null
  overLeafId: string | null
  zone: DropZone | null
  start: (leafId: string) => void
  updateOver: (leafId: string, rect: DOMRect, x: number, y: number) => void
  drop: () => void
  cancel: () => void
}

export const useWorkspaceDrag = create<DragState>((set, get) => ({
  draggingLeafId: null,
  overLeafId: null,
  zone: null,

  start: (leafId) => set({ draggingLeafId: leafId }),

  updateOver: (leafId, rect, x, y) => {
    if (!get().draggingLeafId) return
    set({ overLeafId: leafId, zone: computeDropZone(rect, x, y) })
  },

  drop: () => {
    const { draggingLeafId, overLeafId, zone } = get()
    if (draggingLeafId && overLeafId && zone && draggingLeafId !== overLeafId) {
      const layout = useLayoutStore.getState()
      if (zone === 'center') layout.swap(draggingLeafId, overLeafId)
      else layout.moveLeaf(draggingLeafId, overLeafId, zone)
    }
    set({ draggingLeafId: null, overLeafId: null, zone: null })
  },

  cancel: () => set({ draggingLeafId: null, overLeafId: null, zone: null })
}))
