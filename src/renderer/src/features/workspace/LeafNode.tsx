import { useRef } from 'react'
import type { DropZone, WorkspaceLeafNode } from '@shared/layout'
import { TerminalView } from '@renderer/features/terminal/TerminalView'
import { useLayoutStore } from '@renderer/store/layout'
import { useWorkspaceDrag } from './useWorkspaceDrag'

/** One terminal pane: header (drag handle + close) + terminal + drop overlay. */
export function LeafNode({ node }: { node: WorkspaceLeafNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { draggingLeafId, overLeafId, zone, start, updateOver, drop } = useWorkspaceDrag()
  const closeLeaf = useLayoutStore((s) => s.closeLeaf)
  const isOver = draggingLeafId !== null && overLeafId === node.id

  return (
    <div
      ref={ref}
      className="relative flex h-full w-full flex-col border border-neutral-800"
      onPointerMove={(e) => {
        if (!draggingLeafId || !ref.current) return
        updateOver(node.id, ref.current.getBoundingClientRect(), e.clientX, e.clientY)
      }}
      onPointerUp={() => drop()}
    >
      <div
        className="flex h-6 shrink-0 cursor-grab items-center justify-between bg-neutral-900 px-2 text-xs text-neutral-400 select-none"
        onPointerDown={() => start(node.id)}
      >
        <span className="truncate">{node.sessionId.slice(0, 8)}</span>
        <button
          className="px-1 text-neutral-500 hover:text-red-400"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => closeLeaf(node.id)}
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <TerminalView sessionId={node.sessionId} />
      </div>

      {isOver && zone && <DropIndicator zone={zone} />}
    </div>
  )
}

function DropIndicator({ zone }: { zone: DropZone }): React.JSX.Element {
  const pos: Record<DropZone, string> = {
    center: 'inset-0',
    left: 'inset-y-0 left-0 w-1/2',
    right: 'inset-y-0 right-0 w-1/2',
    top: 'inset-x-0 top-0 h-1/2',
    bottom: 'inset-x-0 bottom-0 h-1/2'
  }
  return (
    <div className={`pointer-events-none absolute border-2 border-blue-400 bg-blue-500/25 ${pos[zone]}`} />
  )
}
