import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

const TITLE_BAR_FALLBACK_HEIGHT = 34
// Mirror the right sidebar's edge-reveal model, oriented to the top edge.
const EDGE = 6
const HOT_BUFFER = 30
const REVEAL_DWELL_MS = 50
// How far above the window's top edge the cursor can sit (e.g. on the menu
// bar) and still keep the bar revealed. DOM mousemove stops firing once the
// cursor leaves the window, so this band is polled via the native pointer.
const OUTSIDE_TOP_LIMIT = 120
const OUTSIDE_POLL_MS = 80

export function AutoHideTitleBar({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const [visible, setVisible] = useState(true)
  const [height, setHeight] = useState(TITLE_BAR_FALLBACK_HEIGHT)
  const titleBarRef = useRef<HTMLDivElement>(null)
  const heightRef = useRef(height)
  const visibleRef = useRef(visible)
  const edgeEnteredAtRef = useRef(0)
  const dwellTimerRef = useRef<number | null>(null)

  heightRef.current = height
  visibleRef.current = visible

  useEffect(
    () => () => {
      void window.appWindow?.setWindowButtonVisibility?.(true)
    },
    []
  )

  useEffect(() => {
    void window.appWindow?.setWindowButtonVisibility?.(!enabled || visible)
  }, [enabled, visible])

  // Position-based reveal/hide — no auto-hide timer. The bar opens once the
  // cursor reaches the top edge (after a short dwell) and stays open until the
  // cursor moves clearly past the bar (its height + a buffer).
  useEffect(() => {
    if (!enabled) {
      setVisible(true)
      return
    }
    // Start hidden when auto-hide turns on.
    setVisible(false)

    const clearDwell = () => {
      if (dwellTimerRef.current != null) {
        window.clearTimeout(dwellTimerRef.current)
        dwellTimerRef.current = null
      }
    }

    const onMouseMove = (event: MouseEvent) => {
      const { clientY } = event
      const now = performance.now()

      const inTopEdge = clientY <= EDGE
      if (!inTopEdge) {
        edgeEnteredAtRef.current = 0
        clearDwell()
      } else if (edgeEnteredAtRef.current === 0) {
        edgeEnteredAtRef.current = now
        clearDwell()
        dwellTimerRef.current = window.setTimeout(() => {
          dwellTimerRef.current = null
          setVisible(true)
        }, REVEAL_DWELL_MS)
      }

      const topIntent =
        inTopEdge && now - edgeEnteredAtRef.current >= REVEAL_DWELL_MS
      if (topIntent) {
        setVisible(true)
      } else if (clientY > heightRef.current + HOT_BUFFER) {
        // Only close once the cursor has moved clearly past the bar.
        setVisible(false)
      }
    }

    // Hide the bar whenever the window loses focus so it never stays revealed
    // over an inactive app.
    const onBlur = () => {
      edgeEnteredAtRef.current = 0
      clearDwell()
      setVisible(false)
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("blur", onBlur)
      clearDwell()
      edgeEnteredAtRef.current = 0
    }
  }, [enabled])

  // Reveal/keep-open when the cursor sits just above the window's top edge,
  // where DOM mousemove no longer fires (the menu-bar region). Mirrors the
  // sidebar's pointerState polling.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const poll = async () => {
      // Don't reveal over an inactive app; the menu-bar reveal only applies
      // while this window is focused.
      if (!document.hasFocus()) {
        setVisible(false)
        return
      }
      const pointer = await window.appWindow
        ?.pointerState?.(OUTSIDE_TOP_LIMIT)
        .catch(() => null)
      if (cancelled || !pointer?.ok || !pointer.cursor || !pointer.bounds) {
        return
      }
      const { cursor, bounds } = pointer
      const relY = cursor.y - bounds.y
      // Only act while the cursor is outside the window above the top edge;
      // inside-window movement is handled by the mousemove listener.
      if (relY >= 0) return
      const withinX = cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width
      if (withinX && relY >= -OUTSIDE_TOP_LIMIT) {
        setVisible(true)
      } else {
        setVisible(false)
      }
    }

    void poll()
    const id = window.setInterval(poll, OUTSIDE_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [enabled])

  useEffect(() => {
    const node = titleBarRef.current
    if (!node) return

    const updateHeight = () => {
      const next = node.getBoundingClientRect().height
      if (next > 0) setHeight(next)
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // Always render the same DOM structure and keep the slide transitions wired
  // up regardless of `enabled`, so the bar (and its project tabs) stay mounted
  // and animate symmetrically. When auto-hide is off, `visible` is held true by
  // the effect above, so pinning slides the bar down with the same animation
  // unpinning uses to slide it up — and remounting (which would replay the
  // tabs' "grow" animation) never happens.
  return (
    <div
      className="relative shrink-0 transition-[height] duration-[180ms] ease-out"
      style={{ height: visible ? height : 0 }}
    >
      <div
        ref={titleBarRef}
        className={cn(
          "absolute inset-x-0 top-0 z-40 transition-transform duration-[180ms] ease-out will-change-transform",
          visible ? "translate-y-0" : "-translate-y-full"
        )}
      >
        {children}
      </div>
    </div>
  )
}
