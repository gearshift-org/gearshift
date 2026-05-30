/**
 * Format a timestamp (ms since epoch) as a short relative string like
 * "just now", "5m ago", "3h ago", "2d ago". Shared by the chat history popover
 * and the terminal recap box.
 */
export function formatRelative(ts: number): string {
  const delta = Date.now() - ts
  if (delta < 60_000) return "just now"
  const m = Math.floor(delta / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
