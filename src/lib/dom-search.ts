// Shared helpers for in-place "find on page" search over rendered DOM, used by
// the markdown preview (FilePreview) and the diff viewer (SingleFileDiff).
// Matches are returned as DOM Ranges so callers can paint them with the CSS
// Custom Highlight API.

/** Collect every Text node under root, descending into shadow roots. */
export function collectTextNodes(root: Node, shadowStyle: string): Text[] {
  const out: Text[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node as Text)
      return
    }
    if (node instanceof Element && node.shadowRoot) {
      // Inject the highlight style into each shadow root once.
      const sr = node.shadowRoot
      if (!sr.querySelector(`style[data-gearshift-search]`)) {
        const s = document.createElement("style")
        s.dataset.gearshiftSearch = "1"
        s.textContent = shadowStyle
        sr.appendChild(s)
      }
      sr.childNodes.forEach(walk)
    }
    node.childNodes.forEach(walk)
  }
  walk(root)
  return out
}

/**
 * Find every case-insensitive occurrence of `query` in the text rendered under
 * `root`, returning a DOM Range per match. Matches that span multiple text
 * nodes (e.g. across inline formatting) are handled by searching a concatenated
 * string and mapping offsets back to nodes.
 */
export function buildMatchRanges(
  root: HTMLElement | null,
  query: string,
  shadowStyle: string,
): Range[] {
  if (!root || !query) return []
  const nodes = collectTextNodes(root, shadowStyle)
  if (nodes.length === 0) return []

  // Build a concatenated string + an index of where each node starts in it,
  // so a query that spans multiple highlighted tokens still matches.
  let combined = ""
  const offsets: number[] = new Array(nodes.length)
  for (let i = 0; i < nodes.length; i++) {
    offsets[i] = combined.length
    combined += nodes[i].data
  }

  const needle = query.toLowerCase()
  const hay = combined.toLowerCase()
  const ranges: Range[] = []

  // Binary-search helper: given an absolute offset, find the index of the node
  // that contains it and the local offset inside that node.
  const locate = (abs: number): { node: Text; offset: number } => {
    let lo = 0
    let hi = nodes.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (offsets[mid] <= abs) lo = mid
      else hi = mid - 1
    }
    return { node: nodes[lo], offset: abs - offsets[lo] }
  }

  let i = 0
  while (i <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, i)
    if (idx === -1) break
    const startAbs = idx
    const endAbs = idx + needle.length
    const start = locate(startAbs)
    // For the end, locate the node containing endAbs - 1 then adjust offset.
    const endHit = locate(Math.max(endAbs - 1, startAbs))
    const endOffsetInNode = endAbs - offsets[nodes.indexOf(endHit.node)]
    const r = document.createRange()
    try {
      r.setStart(start.node, start.offset)
      r.setEnd(endHit.node, endOffsetInNode)
      ranges.push(r)
    } catch {
      // Range can fail if offsets are inconsistent after DOM mutation — skip.
    }
    i = idx + Math.max(needle.length, 1)
  }
  return ranges
}
