import { Fragment, useRef } from 'react'
import type { ReactNode } from 'react'
import type { WorkspaceNode, WorkspaceSplitNode } from '@shared/layout'
import { useResizeHandle } from './useResizeHandle'

interface Props {
  node: WorkspaceSplitNode
  renderChild: (child: WorkspaceNode) => ReactNode
}

/** A flex container along `axis` with draggable dividers between children. */
export function SplitNode({ node, renderChild }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const isRow = node.axis === 'row'
  const onResize = useResizeHandle(node.id, containerRef, node.axis, node.sizes)

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full"
      style={{ flexDirection: isRow ? 'row' : 'column' }}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          <div style={{ flexGrow: node.sizes[i], flexBasis: 0, overflow: 'hidden' }}>
            {renderChild(child)}
          </div>
          {i < node.children.length - 1 && (
            <div
              onPointerDown={(e) => onResize(e, i)}
              className={
                isRow
                  ? 'w-1 shrink-0 cursor-col-resize bg-neutral-800 hover:bg-blue-500'
                  : 'h-1 shrink-0 cursor-row-resize bg-neutral-800 hover:bg-blue-500'
              }
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}
