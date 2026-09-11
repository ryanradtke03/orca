/**
 * The tiling layout is a binary-ish tree: a leaf holds one terminal session,
 * a split arranges children along an axis. Nested splits give arbitrary tiling.
 *
 * This type is persisted (saved layouts / presets live on disk in the main
 * process) and rendered (the renderer walks it recursively), so it lives in
 * `shared/` and is imported by both sides.
 */

export type SplitAxis = 'row' | 'column'

/** Where a dragged pane is dropped, relative to the pane it's dropped onto. */
export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom'

export interface WorkspaceLeafNode {
  type: 'leaf'
  /** Stable node id (distinct from sessionId so a leaf can, in principle, be reassigned). */
  id: string
  sessionId: string
}

export interface WorkspaceSplitNode {
  type: 'split'
  id: string
  axis: SplitAxis
  children: WorkspaceNode[]
  /** Flex ratios, parallel to `children`. Should sum to ~1. */
  sizes: number[]
}

export type WorkspaceNode = WorkspaceLeafNode | WorkspaceSplitNode
