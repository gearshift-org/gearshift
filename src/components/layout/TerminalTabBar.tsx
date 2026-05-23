import { useEffect, useRef, useState } from "react"
import { Plus, X } from "lucide-react"
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { VSCodeIcon } from "@/components/icons/VSCodeIcon"
import { cn } from "@/lib/utils"
import { displayName } from "./terminalName"
import type { TerminalTab } from "./types"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const BUTTON_TOOLTIP_DELAY = 800

type Props = {
  terminals: TerminalTab[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onClose?: (id: string) => void
  onCloseAll?: () => void
  onCloseOthers?: (id: string) => void
  onCloseToRight?: (id: string) => void
  onRename?: (id: string, name: string) => void
  onReorder?: (fromId: string, toId: string) => void
  onOpenInVSCode?: () => void
}

type TabItemProps = {
  terminal: TerminalTab
  isActive: boolean
  hasTabsToRight: boolean
  canShowClose: boolean
  total: number
  renamingId: string | null
  draft: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onSelect: (id: string) => void
  onStartRename: (t: TerminalTab) => void
  onDraftChange: (v: string) => void
  onCommit: () => void
  onCancelRename: () => void
  onClose?: (id: string) => void
  onCloseAll?: () => void
  onCloseOthers?: (id: string) => void
  onCloseToRight?: (id: string) => void
  onOpenInVSCode?: () => void
}

function TerminalTabItem({
  terminal: t,
  isActive,
  hasTabsToRight,
  canShowClose,
  renamingId,
  draft,
  inputRef,
  onSelect,
  onStartRename,
  onDraftChange,
  onCommit,
  onCancelRename,
  onClose,
  onCloseAll,
  onCloseOthers,
  onCloseToRight,
  onOpenInVSCode,
  total,
}: TabItemProps) {
  const isRenaming = t.id === renamingId
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: t.id, disabled: isRenaming })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={setNodeRef as unknown as React.Ref<HTMLDivElement>}
        style={style}
        className={cn(
          "group relative flex h-full min-w-[140px] cursor-pointer items-center gap-2 border-r border-border/60 px-3 text-xs transition-colors",
          isActive
            ? "bg-accent font-medium text-foreground"
            : "text-muted-foreground hover:bg-accent/40",
          isDragging && "opacity-80 shadow-lg",
        )}
        onClick={() => onSelect(t.id)}
        onDoubleClick={() => onStartRename(t)}
        {...attributes}
        {...listeners}
      >
        {isRenaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onBlur={onCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommit()
              if (e.key === "Escape") onCancelRename()
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-xs outline-none"
          />
        ) : (
          <span className="truncate">{displayName(t)}</span>
        )}
        {canShowClose && !isRenaming && (
          <Tooltip delay={BUTTON_TOOLTIP_DELAY}>
            <TooltipTrigger
              render={
                <span
                  role="button"
                  tabIndex={-1}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose?.(t.id)
                  }}
                  className={cn(
                    "ml-auto grid size-5 place-items-center rounded-sm opacity-0 transition-colors hover:bg-foreground/15 hover:text-foreground group-hover:opacity-100",
                    isActive && "opacity-60",
                  )}
                >
                  <X className="size-3.5" />
                </span>
              }
            />
            <TooltipContent>Close terminal</TooltipContent>
          </Tooltip>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[200px] whitespace-nowrap">
        <ContextMenuItem onClick={() => onStartRename(t)}>
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onClose?.(t.id)}>Close</ContextMenuItem>
        <ContextMenuItem
          onClick={() => onCloseToRight?.(t.id)}
          disabled={!hasTabsToRight}
        >
          Close to the Right
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onCloseOthers?.(t.id)}
          disabled={total <= 1}
        >
          Close Other Tabs
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onCloseAll?.()}>
          Close All Tabs
        </ContextMenuItem>
        {onOpenInVSCode && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onOpenInVSCode()}>
              <VSCodeIcon className="size-3.5" />
              Open in VSCode
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function TerminalTabBar({
  terminals,
  activeId,
  onSelect,
  onAdd,
  onClose,
  onCloseAll,
  onCloseOthers,
  onCloseToRight,
  onRename,
  onReorder,
  onOpenInVSCode,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingId) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renamingId])

  const startRename = (t: TerminalTab) => {
    setDraft(t.customName ?? displayName(t))
    setRenamingId(t.id)
  }

  const commit = () => {
    if (!renamingId) return
    const next = draft.trim()
    onRename?.(renamingId, next)
    setRenamingId(null)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onReorder?.(String(active.id), String(over.id))
  }

  return (
    <div className="box-content flex h-[34px] shrink-0 items-stretch border-b border-border bg-background">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext
          items={terminals.map((t) => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          {terminals.map((t, i) => (
            <TerminalTabItem
              key={t.id}
              terminal={t}
              isActive={t.id === activeId}
              hasTabsToRight={i < terminals.length - 1}
              canShowClose={!!onClose && terminals.length > 1}
              total={terminals.length}
              renamingId={renamingId}
              draft={draft}
              inputRef={inputRef}
              onSelect={onSelect}
              onStartRename={startRename}
              onDraftChange={setDraft}
              onCommit={commit}
              onCancelRename={() => setRenamingId(null)}
              onClose={onClose}
              onCloseAll={onCloseAll}
              onCloseOthers={onCloseOthers}
              onCloseToRight={onCloseToRight}
              onOpenInVSCode={onOpenInVSCode}
            />
          ))}
        </SortableContext>
      </DndContext>
      <Tooltip delay={BUTTON_TOOLTIP_DELAY}>
        <TooltipTrigger
          render={
            <button
              onClick={onAdd}
              aria-label="Add terminal"
              className="group/add grid h-full w-10 place-items-center text-muted-foreground"
            >
              <span className="grid size-5 place-items-center rounded-sm transition-colors group-hover/add:bg-foreground/15 group-hover/add:text-foreground">
                <Plus className="size-3.5" />
              </span>
            </button>
          }
        />
        <TooltipContent>New terminal</TooltipContent>
      </Tooltip>
    </div>
  )
}
