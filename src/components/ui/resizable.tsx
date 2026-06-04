import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        // Keep the visible divider 1px, but make the actual hit box wider and
        // overlap adjacent panes. This lets split dragging win over xterm's
        // edge scrollbar, which otherwise scrolls the terminal before resizing.
        "relative z-40 -mx-[3px] flex w-[7px] shrink-0 touch-none items-center justify-center bg-transparent ring-offset-background",
        "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border before:transition-colors before:content-['']",
        "hover:before:bg-foreground/30 data-[resize-handle-state=drag]:before:bg-foreground/40 data-[resize-handle-state=hover]:before:bg-foreground/30",
        "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden",
        "aria-[orientation=horizontal]:-my-[3px] aria-[orientation=horizontal]:mx-0 aria-[orientation=horizontal]:h-[7px] aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:before:inset-x-0 aria-[orientation=horizontal]:before:top-1/2 aria-[orientation=horizontal]:before:left-0 aria-[orientation=horizontal]:before:h-px aria-[orientation=horizontal]:before:w-full aria-[orientation=horizontal]:before:translate-x-0 aria-[orientation=horizontal]:before:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
