import type { SplitDirection, TerminalLayout } from "./types"

/** A single-pane leaf node. */
export function leaf(paneId: string): TerminalLayout {
  return { type: "leaf", paneId }
}

function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count)
}

/**
 * Build a default layout for a flat list of pane ids: one leaf when there's a
 * single pane, otherwise a horizontal row. Used for legacy tabs (and freshly
 * created ones) that have no persisted layout.
 */
export function defaultLayout(paneIds: string[]): TerminalLayout {
  if (paneIds.length <= 1) return leaf(paneIds[0] ?? "")
  return {
    type: "split",
    direction: "horizontal",
    children: paneIds.map(leaf),
    sizes: equalSizes(paneIds.length),
  }
}

/** The layout for a tab, falling back to a default row when none is stored. */
export function ensureLayout(
  layout: TerminalLayout | undefined,
  paneIds: string[]
): TerminalLayout {
  return layout ? reconcileLayout(layout, paneIds) : defaultLayout(paneIds)
}

/** Pane ids in visual (left-to-right, top-to-bottom) order. */
export function orderedPaneIds(node: TerminalLayout): string[] {
  if (node.type === "leaf") return [node.paneId]
  return node.children.flatMap(orderedPaneIds)
}

/**
 * Split the leaf for `targetPaneId` into two panes along `direction`, placing
 * `newPaneId` after it. When the target's parent already runs in the same
 * direction, the new pane is inserted as an even sibling (so repeated splits in
 * one direction stay evenly sized); otherwise a nested split is created.
 */
export function splitLeaf(
  node: TerminalLayout,
  targetPaneId: string,
  newPaneId: string,
  direction: SplitDirection
): TerminalLayout {
  if (node.type === "leaf") {
    if (node.paneId !== targetPaneId) return node
    return {
      type: "split",
      direction,
      children: [leaf(targetPaneId), leaf(newPaneId)],
      sizes: equalSizes(2),
    }
  }
  const directIdx = node.children.findIndex(
    (c) => c.type === "leaf" && c.paneId === targetPaneId
  )
  if (directIdx >= 0 && node.direction === direction) {
    const children = node.children.slice()
    children.splice(directIdx + 1, 0, leaf(newPaneId))
    return { ...node, children, sizes: equalSizes(children.length) }
  }
  return {
    ...node,
    children: node.children.map((c) =>
      splitLeaf(c, targetPaneId, newPaneId, direction)
    ),
  }
}

/**
 * Remove the leaf for `paneId`. Split nodes left with a single child collapse
 * into that child. Returns null when the tree becomes empty.
 */
export function removeLeaf(
  node: TerminalLayout,
  paneId: string
): TerminalLayout | null {
  if (node.type === "leaf") return node.paneId === paneId ? null : node
  const children = node.children
    .map((c) => removeLeaf(c, paneId))
    .filter((c): c is TerminalLayout => c !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...node, children }
}

/** Append a leaf for `paneId` to the root split (or wrap a lone leaf). */
function appendLeaf(node: TerminalLayout, paneId: string): TerminalLayout {
  if (node.type === "split") {
    const children = [...node.children, leaf(paneId)]
    return { ...node, children, sizes: equalSizes(children.length) }
  }
  return {
    type: "split",
    direction: "horizontal",
    children: [node, leaf(paneId)],
    sizes: equalSizes(2),
  }
}

/**
 * Reconcile a (possibly stale) layout against the authoritative set of pane
 * ids: drop leaves whose pane no longer exists and append any panes missing
 * from the tree. Guarantees every pane is rendered exactly once.
 */
export function reconcileLayout(
  layout: TerminalLayout,
  paneIds: string[]
): TerminalLayout {
  const wanted = new Set(paneIds)
  let result: TerminalLayout | null = layout
  for (const id of orderedPaneIds(layout)) {
    if (!wanted.has(id)) result = result ? removeLeaf(result, id) : null
  }
  if (!result) return defaultLayout(paneIds)
  const have = new Set(orderedPaneIds(result))
  for (const id of paneIds) {
    if (!have.has(id)) result = appendLeaf(result, id)
  }
  return result
}

/**
 * Exchange the positions of two panes anywhere in the tree by swapping the
 * pane ids at their leaves. Works across nesting levels — the structure stays,
 * only which pane lives where changes.
 */
export function swapLeaves(
  node: TerminalLayout,
  paneIdA: string,
  paneIdB: string
): TerminalLayout {
  if (node.type === "leaf") {
    if (node.paneId === paneIdA) return leaf(paneIdB)
    if (node.paneId === paneIdB) return leaf(paneIdA)
    return node
  }
  return {
    ...node,
    children: node.children.map((c) => swapLeaves(c, paneIdA, paneIdB)),
  }
}

/**
 * Insert a new leaf next to an existing target leaf, along `direction`. When
 * the target's parent already runs in that direction the leaf joins as an even
 * sibling; otherwise a nested split is created. `before` places the new leaf
 * ahead of the target (left/top) rather than after it (right/bottom).
 */
export function insertBeside(
  node: TerminalLayout,
  targetPaneId: string,
  newPaneId: string,
  direction: SplitDirection,
  before: boolean
): TerminalLayout {
  if (node.type === "leaf") {
    if (node.paneId !== targetPaneId) return node
    const children = before
      ? [leaf(newPaneId), leaf(targetPaneId)]
      : [leaf(targetPaneId), leaf(newPaneId)]
    return { type: "split", direction, children, sizes: equalSizes(2) }
  }
  const idx = node.children.findIndex(
    (c) => c.type === "leaf" && c.paneId === targetPaneId
  )
  if (idx >= 0 && node.direction === direction) {
    const children = node.children.slice()
    children.splice(before ? idx : idx + 1, 0, leaf(newPaneId))
    return { ...node, children, sizes: equalSizes(children.length) }
  }
  return {
    ...node,
    children: node.children.map((c) =>
      insertBeside(c, targetPaneId, newPaneId, direction, before)
    ),
  }
}

/**
 * Move an existing pane next to a target pane, creating/extending a split on
 * the requested side. Removes the pane from its old spot first (collapsing any
 * split left with a single child), then re-inserts it beside the target.
 */
export function moveLeafBeside(
  layout: TerminalLayout,
  movingPaneId: string,
  targetPaneId: string,
  direction: SplitDirection,
  before: boolean
): TerminalLayout {
  if (movingPaneId === targetPaneId) return layout
  const removed = removeLeaf(layout, movingPaneId)
  if (!removed) return layout
  return insertBeside(removed, targetPaneId, movingPaneId, direction, before)
}

/**
 * Stable, unique key for a layout node among its siblings — used as the React
 * key and the react-resizable-panels panel id (which tracks each panel's drag
 * size while mounted).
 *
 * Keyed off the node's *first* pane id rather than the whole pane set. This is
 * what keeps a resized panel's size when you split one of its panes: splitting
 * pane B (in a top/bottom-resized layout) wraps `leaf(B)` into
 * `split([leaf(B), leaf(C)])`, and since B stays the first pane the slot id
 * remains "B" instead of becoming "g:B-C". The panel library maps the existing
 * size to the unchanged id, so the surrounding proportions survive and only the
 * new split divides evenly. A node's first pane id is globally unique (each pane
 * lives in exactly one subtree), so sibling keys never collide.
 */
export function nodeKey(node: TerminalLayout): string {
  return node.type === "leaf" ? node.paneId : orderedPaneIds(node)[0]
}

/** Persist panel percentages for one split node, identified by its stable key. */
export function updateSplitSizes(
  node: TerminalLayout,
  splitKey: string,
  sizes: number[]
): TerminalLayout {
  if (node.type === "leaf") return node
  const children = node.children.map((child) =>
    updateSplitSizes(child, splitKey, sizes)
  )
  if (nodeKey(node) !== splitKey) return { ...node, children }
  return {
    ...node,
    children,
    sizes: sizes.slice(0, node.children.length),
  }
}
