import { cn } from "@/lib/utils"

/**
 * Class for a stacked, always-mounted layer (project workspace, tab pane) that
 * is hidden when inactive. `content-visibility:hidden` skips layout/paint of
 * the hidden subtree entirely (state preserved), so window resizes don't run
 * pane-layout ResizeObserver storms — 100-300ms stalls — for panes nobody can
 * see. TerminalView pairs this with its `isVisible` prop to also skip xterm
 * refits while hidden and replay one fit on reveal.
 */
export function hiddenLayerClass(hidden: boolean, extra?: string): string {
  return cn(
    "absolute inset-0 transition-opacity duration-75",
    hidden && "pointer-events-none opacity-0 [content-visibility:hidden]",
    extra
  )
}
