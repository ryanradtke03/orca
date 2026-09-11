import { create } from 'zustand'
import type { WorkspaceNode, WorkspaceLeafNode, DropZone, SplitAxis } from '@shared/layout'

/* ------------------------------------------------------------------ *
 * Pure tree operations. No React, no DOM — return a new tree.
 * These are the unit-testable heart of the tiling behaviour.
 * ------------------------------------------------------------------ */

const uid = (): string => crypto.randomUUID()

export function makeLeaf(sessionId: string): WorkspaceLeafNode {
  return { type: 'leaf', id: uid(), sessionId }
}

function zoneAxis(zone: DropZone): SplitAxis {
  return zone === 'left' || zone === 'right' ? 'row' : 'column'
}

function zoneBefore(zone: DropZone): boolean {
  return zone === 'left' || zone === 'top'
}

/** Insert `incoming` next to the leaf `targetLeafId`, creating/extending a split. */
export function insertBeside(
  tree: WorkspaceNode,
  targetLeafId: string,
  zone: DropZone,
  incoming: WorkspaceLeafNode
): WorkspaceNode {
  if (tree.type === 'leaf') {
    if (tree.id !== targetLeafId) return tree
    const axis = zoneAxis(zone)
    const children = zoneBefore(zone) ? [incoming, tree] : [tree, incoming]
    return { type: 'split', id: uid(), axis, children, sizes: [0.5, 0.5] }
  }

  // split: recurse; if a direct child is the target leaf and axis matches, splice inline
  return { ...tree, children: tree.children.map((c) => insertBeside(c, targetLeafId, zone, incoming)) }
}

/** Swap the sessions of two leaves (the "center" drop). */
export function swapLeaves(tree: WorkspaceNode, aLeafId: string, bLeafId: string): WorkspaceNode {
  const a = findLeaf(tree, aLeafId)
  const b = findLeaf(tree, bLeafId)
  if (!a || !b) return tree
  return mapLeaves(tree, (leaf) => {
    if (leaf.id === aLeafId) return { ...leaf, sessionId: b.sessionId }
    if (leaf.id === bLeafId) return { ...leaf, sessionId: a.sessionId }
    return leaf
  })
}

/** Remove a leaf; collapse splits that end up with a single child. Returns null if tree empties. */
export function removeLeaf(tree: WorkspaceNode, leafId: string): WorkspaceNode | null {
  if (tree.type === 'leaf') return tree.id === leafId ? null : tree

  const children = tree.children
    .map((c) => removeLeaf(c, leafId))
    .filter((c): c is WorkspaceNode => c !== null)

  if (children.length === 0) return null
  if (children.length === 1) return children[0] // collapse
  const sizes = normalize(children.map(() => 1))
  return { ...tree, children, sizes }
}

/** Adjust the ratios of a split node. */
export function setSizes(tree: WorkspaceNode, splitId: string, sizes: number[]): WorkspaceNode {
  if (tree.type === 'leaf') return tree
  if (tree.id === splitId) return { ...tree, sizes: normalize(sizes) }
  return { ...tree, children: tree.children.map((c) => setSizes(c, splitId, sizes)) }
}

/** Move an existing leaf beside another (drag → row/col zones): remove then insert. */
export function moveLeaf(
  tree: WorkspaceNode,
  movedLeafId: string,
  targetLeafId: string,
  zone: DropZone
): WorkspaceNode {
  const moved = findLeaf(tree, movedLeafId)
  if (!moved || movedLeafId === targetLeafId) return tree
  const pruned = removeLeaf(tree, movedLeafId)
  if (!pruned) return tree
  return insertBeside(pruned, targetLeafId, zone, makeLeaf(moved.sessionId))
}

/* ---- helpers ---- */

export function findLeaf(tree: WorkspaceNode, leafId: string): WorkspaceLeafNode | null {
  if (tree.type === 'leaf') return tree.id === leafId ? tree : null
  for (const c of tree.children) {
    const found = findLeaf(c, leafId)
    if (found) return found
  }
  return null
}

function mapLeaves(
  tree: WorkspaceNode,
  fn: (leaf: WorkspaceLeafNode) => WorkspaceLeafNode
): WorkspaceNode {
  if (tree.type === 'leaf') return fn(tree)
  return { ...tree, children: tree.children.map((c) => mapLeaves(c, fn)) }
}

function normalize(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0) || 1
  return sizes.map((s) => s / total)
}

/* ------------------------------------------------------------------ *
 * Store: the active project's layout tree + thin action wrappers.
 * ------------------------------------------------------------------ */

interface LayoutState {
  tree: WorkspaceNode | null
  setTree: (tree: WorkspaceNode | null) => void
  /** Add a session — as the first pane, or beside an existing leaf. */
  addSession: (sessionId: string, target?: { leafId: string; zone: DropZone }) => void
  moveLeaf: (movedLeafId: string, targetLeafId: string, zone: DropZone) => void
  swap: (aLeafId: string, bLeafId: string) => void
  resize: (splitId: string, sizes: number[]) => void
  closeLeaf: (leafId: string) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  tree: null,
  setTree: (tree) => set({ tree }),
  addSession: (sessionId, target) =>
    set((s) => {
      const incoming = makeLeaf(sessionId)
      if (!s.tree) return { tree: incoming }
      if (!target) return s // no target and tree exists: caller should pass a target
      return { tree: insertBeside(s.tree, target.leafId, target.zone, incoming) }
    }),
  moveLeaf: (movedLeafId, targetLeafId, zone) =>
    set((s) => (s.tree ? { tree: moveLeaf(s.tree, movedLeafId, targetLeafId, zone) } : s)),
  swap: (aLeafId, bLeafId) =>
    set((s) => (s.tree ? { tree: swapLeaves(s.tree, aLeafId, bLeafId) } : s)),
  resize: (splitId, sizes) =>
    set((s) => (s.tree ? { tree: setSizes(s.tree, splitId, sizes) } : s)),
  closeLeaf: (leafId) => set((s) => (s.tree ? { tree: removeLeaf(s.tree, leafId) } : s))
}))
