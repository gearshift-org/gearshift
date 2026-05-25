import { useEffect, useRef, useState } from "react"
import { FileDiff, Plus, TerminalSquare, X } from "lucide-react"
import { FileIcon } from "@/components/icons/FileIcon"
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
import { AgentSpinner } from "./AgentSpinner"
import {
  TAB_LABEL_CLASS,
  TAB_NAME_TOOLTIP_DELAY_MS,
  TAB_OPEN_TRANSITION_CLASS,
  TAB_WIDTH_CLASS,
  useTabOpenAnimation,
} from "./tabSizing"
import { displayName, tabDisplayName } from "./terminalName"
import type { TerminalAgentName, TerminalTab, WorkspaceTab } from "./types"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Props = {
  tabs: WorkspaceTab[]
  activeId: string
  animationScopeKey?: string
  openingTabId?: string | null
  onSelect: (id: string) => void
  onAdd: (agentName?: TerminalAgentName) => void
  onClose?: (id: string) => void
  onCloseAll?: () => void
  onCloseOthers?: (id: string) => void
  onCloseToRight?: (id: string) => void
  onRename?: (id: string, name: string) => void
  onReorder?: (fromId: string, toId: string) => void
  onPin?: (id: string) => void
  onOpenInVSCode?: () => void
}

const AGENT_TERMINAL_OPTIONS: Array<{
  value: TerminalAgentName
  label: string
}> = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
  { value: "pi", label: "Pi" },
  { value: "gemini", label: "Gemini" },
]

type TabItemProps = {
  tab: WorkspaceTab
  isActive: boolean
  hasTabsToRight: boolean
  total: number
  animateOpen: boolean
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
  onPin?: (id: string) => void
  onOpenInVSCode?: () => void
}

function TabIcon({ tab }: { tab: WorkspaceTab }) {
  if (tab.kind === "diff") return <FileDiff className="size-3.5 shrink-0" />
  if (tab.kind === "file") {
    return (
      <FileIcon
        name={tab.path.split("/").pop() ?? tab.path}
        className="size-4 shrink-0"
      />
    )
  }
  return <TerminalSquare className="size-3.5 shrink-0" />
}

function WorkspaceTabItem({
  tab: t,
  isActive,
  hasTabsToRight,
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
  onPin,
  onOpenInVSCode,
  total,
  animateOpen,
}: TabItemProps) {
  const isRenaming = t.id === renamingId
  const isTerminal = t.kind === "terminal"
  const tabTitle = tabDisplayName(t)
  const isPreview =
    (t.kind === "diff" || t.kind === "file") && t.preview === true
  const hasHiddenWorkingAgent =
    isTerminal &&
    !isActive &&
    t.panes.some((pane) => pane.agentStatus?.working)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: t.id, disabled: isRenaming })

  const openAnim = useTabOpenAnimation(animateOpen)
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
    ...openAnim.style,
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={setNodeRef as unknown as React.Ref<HTMLDivElement>}
        style={style}
        className={cn(
          "group relative flex h-full min-w-[140px] cursor-pointer items-center gap-2 border-r border-border/60 px-3 text-xs transition-colors",
          TAB_WIDTH_CLASS,
          TAB_OPEN_TRANSITION_CLASS,
          openAnim.isOpening && "overflow-hidden",
          isActive
            ? "bg-secondary text-foreground"
            : "text-foreground hover:bg-accent/40",
          isDragging && "opacity-80 shadow-lg",
        )}
        onClick={() => onSelect(t.id)}
        onDoubleClick={() => {
          if (isTerminal) {
            onStartRename(t)
          } else if (isPreview) {
            onPin?.(t.id)
          }
        }}
        {...attributes}
        {...listeners}
      >
        <TabIcon tab={t} />
        {hasHiddenWorkingAgent ? <AgentSpinner className="-ml-1" /> : null}
        {isRenaming && isTerminal ? (
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
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        ) : (
          <Tooltip>
            <TooltipTrigger
              delay={TAB_NAME_TOOLTIP_DELAY_MS}
              render={
                <span className={cn(TAB_LABEL_CLASS, isPreview && "italic")}>
                  {tabTitle}
                </span>
              }
            />
            <TooltipContent side="bottom" className="max-w-[480px] break-all">
              {tabTitle}
            </TooltipContent>
          </Tooltip>
        )}
        {!isRenaming && (
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
        )}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[200px] whitespace-nowrap">
        {isTerminal && (
          <>
            <ContextMenuItem onClick={() => onStartRename(t)}>
              Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {isPreview && (
          <>
            <ContextMenuItem onClick={() => onPin?.(t.id)}>
              Keep Open
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
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

export function WorkspaceTabBar({
  tabs,
  activeId,
  animationScopeKey = "default",
  openingTabId = null,
  onSelect,
  onAdd,
  onClose,
  onCloseAll,
  onCloseOthers,
  onCloseToRight,
  onRename,
  onReorder,
  onPin,
  onOpenInVSCode,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const previousTabsRef = useRef<{ scopeKey: string; ids: Set<string> } | null>(
    null,
  )
  const previousTabs = previousTabsRef.current
  const openingTabIds = new Set(
    previousTabs?.scopeKey === animationScopeKey
      ? tabs.filter((tab) => !previousTabs.ids.has(tab.id)).map((tab) => tab.id)
      : [],
  )

  useEffect(() => {
    previousTabsRef.current = {
      scopeKey: animationScopeKey,
      ids: new Set(tabs.map((tab) => tab.id)),
    }
  }, [animationScopeKey, tabs])

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
    <div className="flex h-[34px] shrink-0 items-stretch border-b border-border bg-background">
      <div className="terminal-tabs-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={tabs.map((t) => t.id)}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map((t, i) => (
              <WorkspaceTabItem
                key={t.id}
                tab={t}
                isActive={t.id === activeId}
                hasTabsToRight={i < tabs.length - 1}
                total={tabs.length}
                animateOpen={openingTabIds.has(t.id) || t.id === openingTabId}
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
                onPin={onPin}
                onOpenInVSCode={onOpenInVSCode}
              />
            ))}
          </SortableContext>
        </DndContext>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="New terminal"
                className="group/add sticky right-0 grid h-full w-10 shrink-0 place-items-center bg-background text-muted-foreground"
              >
                <span className="grid size-5 place-items-center rounded-sm transition-colors group-hover/add:bg-foreground/15 group-hover/add:text-foreground">
                  <Plus className="size-3.5" />
                </span>
              </button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onAdd()}>
              <TerminalSquare className="size-3.5" />
              Terminal
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {AGENT_TERMINAL_OPTIONS.map((agent) => (
              <DropdownMenuItem
                key={agent.value}
                onClick={() => onAdd(agent.value)}
              >
                {agent.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
