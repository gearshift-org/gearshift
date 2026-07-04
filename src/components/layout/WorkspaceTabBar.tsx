import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  FileDiff,
  GitCommitVertical,
  MonitorPlay,
  Plus,
  Settings,
  TerminalSquare,
  X,
} from "lucide-react"
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
import { terminalAgentIsActive, terminalTabAgentState } from "@/lib/agentStatus"
import { AgentSpinner } from "./AgentSpinner"
import { AgentAttention } from "./AgentAttention"
import { AgentDone } from "./AgentDone"
import { AgentIcon } from "./AgentIcon"
import { hasAgentIcon } from "./agentIcons"
import {
  TAB_LABEL_CLASS,
  TAB_NAME_TOOLTIP_DELAY_MS,
  TAB_OPEN_TRANSITION_CLASS,
  TAB_WIDTH_SHRINK_CLASS,
  useTabOpenAnimation,
} from "./tabSizing"
import { displayName, tabDisplayName } from "./terminalName"
import {
  AGENT_TERMINAL_LABELS,
  AGENT_TERMINAL_NAMES,
} from "@/lib/agentTerminalOptions"
import type {
  TerminalAgentName,
  TerminalPane,
  TerminalTab,
  WorkspaceTab,
} from "./types"
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
  onConfigureAgents?: () => void
  onClose?: (id: string) => void
  onCloseAll?: () => void
  onCloseAllTerminals?: () => void
  onCloseOthers?: (id: string) => void
  onCloseToRight?: (id: string) => void
  onRename?: (id: string, name: string) => void
  onReorder?: (fromId: string, toId: string) => void
  onPin?: (id: string) => void
  onOpenInVSCode?: () => void
  // Rendered at the right edge of the tab bar (e.g. window controls in the
  // vertical project layout, where the tab bar doubles as the top bar).
  trailing?: ReactNode
  // Rendered at the left edge of the tab bar (e.g. traffic-light spacer + the
  // expand control when the vertical project sidebar is collapsed).
  leading?: ReactNode
  // Treat the bar as the window's top drag region.
  draggable?: boolean
}

const AGENT_TERMINAL_OPTIONS = AGENT_TERMINAL_NAMES.map((agentName) => ({
  value: agentName,
  label: AGENT_TERMINAL_LABELS[agentName],
}))

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
  onCloseAllTerminals?: () => void
  onCloseOthers?: (id: string) => void
  onCloseToRight?: (id: string) => void
  onPin?: (id: string) => void
  onOpenInVSCode?: () => void
}

function TabIcon({
  tab,
  agentName,
}: {
  tab: WorkspaceTab
  agentName?: TerminalAgentName
}) {
  if (tab.kind === "diff") return <FileDiff className="size-3.5 shrink-0" />
  if (tab.kind === "commit")
    return <GitCommitVertical className="size-3.5 shrink-0" />
  if (tab.kind === "devPreview")
    return <MonitorPlay className="size-3.5 shrink-0" />
  if (tab.kind === "file") {
    return (
      <FileIcon
        name={tab.path.split("/").pop() ?? tab.path}
        className="size-4 shrink-0"
      />
    )
  }
  // An active agent's brand icon stands in for the generic terminal icon.
  if (hasAgentIcon(agentName)) {
    return <AgentIcon agent={agentName} className="size-3.5" />
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
  onCloseAllTerminals,
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
    (t.kind === "diff" || t.kind === "file" || t.kind === "commit") &&
    t.preview === true
  const agentState = terminalTabAgentState(t)
  const hasWorkingAgent = isTerminal && agentState === "working"
  const hasAttentionAgent = isTerminal && agentState === "blocked"
  const hasDoneAgent = isTerminal && agentState === "done"
  // The brand icon of the agent active in the *focused* pane (running, working,
  // or waiting on the user) — matching how the tab title tracks the active
  // pane. A focused pane with no agent shows the generic terminal icon, even if
  // a sibling split pane is running an agent.
  const paneAgent = (pane: TerminalPane | undefined) => {
    if (!pane || !terminalAgentIsActive(pane.agentStatus)) return undefined
    return pane.agentStatus?.agentName
  }
  const activeAgentName = isTerminal
    ? paneAgent(
        t.panes.find((pane) => pane.id === t.activePaneId) ?? t.panes[0]
      )
    : undefined
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
          "group relative flex h-[28px] cursor-pointer items-center gap-2 rounded-sm border border-transparent px-2.5 text-xs transition-colors",
          TAB_WIDTH_SHRINK_CLASS,
          TAB_OPEN_TRANSITION_CLASS,
          openAnim.isOpening && "overflow-hidden",
          isActive
            ? "bg-foreground/[0.12] text-foreground"
            : "text-muted-foreground hover:bg-foreground/[0.12] hover:text-foreground",
          isDragging && "opacity-80 shadow-lg"
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
        <TabIcon tab={t} agentName={activeAgentName} />
        {hasWorkingAgent ? (
          <AgentSpinner className="-ml-1" />
        ) : hasAttentionAgent ? (
          <AgentAttention className="-ml-1" />
        ) : hasDoneAgent ? (
          <AgentDone className="-ml-1" />
        ) : null}
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
              "-mr-1 ml-auto grid size-5 place-items-center rounded-sm opacity-0 transition-colors group-hover:opacity-100 hover:bg-foreground/15 hover:text-foreground",
              isActive && "opacity-60"
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
        {isTerminal && onCloseAllTerminals && (
          <ContextMenuItem onClick={() => onCloseAllTerminals()}>
            Close All Terminals
          </ContextMenuItem>
        )}
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
  onConfigureAgents,
  onClose,
  onCloseAll,
  onCloseAllTerminals,
  onCloseOthers,
  onCloseToRight,
  onRename,
  onReorder,
  onPin,
  onOpenInVSCode,
  trailing,
  leading,
  draggable = false,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const previousTabsRef = useRef<{ scopeKey: string; ids: Set<string> } | null>(
    null
  )
  const previousTabs = previousTabsRef.current
  const openingTabIds = new Set(
    previousTabs?.scopeKey === animationScopeKey
      ? tabs.filter((tab) => !previousTabs.ids.has(tab.id)).map((tab) => tab.id)
      : []
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
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onReorder?.(String(active.id), String(over.id))
  }

  return (
    <div
      data-terminal-tab-drop-target="true"
      className={cn(
        "flex h-[38px] shrink-0 items-stretch pt-1",
        draggable && "[-webkit-app-region:drag]"
      )}
    >
      {leading && <div className="flex shrink-0 items-center">{leading}</div>}
      <div
        className={cn(
          // Left inset matches the workspace's p-2 (8px) so the first tab lines
          // up with the terminal card's left edge below it.
          "terminal-tabs-scroll flex min-w-0 items-center gap-1 overflow-hidden py-[3px] pl-2",
          // In draggable mode the scroll area shrinks to its tabs so the empty
          // remainder (the spacer below) becomes a window-drag region.
          draggable ? "[-webkit-app-region:no-drag]" : "flex-1"
        )}
      >
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
                onCloseAllTerminals={onCloseAllTerminals}
                onCloseOthers={onCloseOthers}
                onCloseToRight={onCloseToRight}
                onPin={onPin}
                onOpenInVSCode={onOpenInVSCode}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="New terminal"
              // The add button sits outside the scrolling tab list so it stays
              // fully visible and never overlaps tabs when they overflow — the
              // tabs scroll within the bounded area to its left. mx-2 keeps an
              // equal gap on both sides: from the last tab on the left, and from
              // the right edge / sidebar on the right when the tabs fill the bar.
              className={cn(
                "group/add mx-2 grid h-[28px] w-8 shrink-0 place-items-center self-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/[0.12] hover:text-foreground",
                draggable && "[-webkit-app-region:no-drag]"
              )}
            >
              <span className="grid size-5 place-items-center rounded-sm">
                <Plus className="size-3.5" />
              </span>
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem className="gap-2" onClick={() => onAdd()}>
            <TerminalSquare className="size-3.5" />
            Terminal
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {AGENT_TERMINAL_OPTIONS.map((agent) => (
            <DropdownMenuItem
              key={agent.value}
              className="gap-2"
              onClick={() => onAdd(agent.value)}
            >
              <AgentIcon agent={agent.value} className="size-3.5" />
              {agent.label}
            </DropdownMenuItem>
          ))}
          {onConfigureAgents ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2" onClick={onConfigureAgents}>
                <Settings className="size-3.5" />
                Configure agents…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {draggable && <div className="min-w-0 flex-1 self-stretch" />}
      {trailing && <div className="flex shrink-0 items-center">{trailing}</div>}
    </div>
  )
}
