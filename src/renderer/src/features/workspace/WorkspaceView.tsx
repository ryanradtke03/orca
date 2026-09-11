import type { WorkspaceNode } from '@shared/layout'
import { useLayoutStore } from '@renderer/store/layout'
import { SplitNode } from './SplitNode'
import { LeafNode } from './LeafNode'

/** Recursive dispatch: a node is either a terminal leaf or a split of children. */
function NodeView({ node }: { node: WorkspaceNode }): React.JSX.Element {
  if (node.type === 'leaf') return <LeafNode node={node} />
  return (
    <SplitNode node={node} renderChild={(child) => <NodeView key={child.id} node={child} />} />
  )
}

/** Entry point: renders the active project's layout tree. */
export function WorkspaceView(): React.JSX.Element {
  const tree = useLayoutStore((s) => s.tree)

  if (!tree) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        No panes yet — spawn a session
      </div>
    )
  }

  return (
    <div className="h-full w-full">
      <NodeView node={tree} />
    </div>
  )
}
