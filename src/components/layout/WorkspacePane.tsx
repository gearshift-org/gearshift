import { Fragment, useState } from "react"
import { Columns2, Rows3, SplitSquareHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { TerminalView } from "./TerminalView"
import { SingleFileDiff } from "./SingleFileDiff"
import { FilePreview } from "./FilePreview"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { loadDiffViewMode, saveDiffViewMode } from "@/lib/projects"
import { tabDisplayName } from "./terminalName"
import type {
  Project,
  TerminalPane as TerminalPaneType,
  TerminalTab,
  WorkspaceTab,
} from "./types"

type Props = {
  project: Project | undefined
  isActive?: boolean
  onTitleChange?: (tabId: string, paneId: string, title: string) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onSplitTerminal?: (tabId: string) => void
  onClosePane?: (tabId: string, paneId: string) => void
  onFocusPane?: (tabId: string, paneId: string) => void
}

function TerminalPaneView({
  tab,
  pane,
  isTabActive,
  onTitleChange,
  onStartTerminal,
  onFocus,
}: {
  tab: TerminalTab
  pane: TerminalPaneType
  isTabActive: boolean
  onTitleChange?: (tabId: string, paneId: string, title: string) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onFocus?: () => void
}) {
  if (pane.pendingStart) {
    return (
      <div
        onClick={onFocus}
        className="grid h-full place-items-center bg-card"
      >
        <div className="flex flex-col items-center gap-3 text-xs text-muted-foreground">
          <span>"{tab.customName ?? tab.name}" is not running.</span>
          <button
            onClick={() => onStartTerminal?.(tab.id, pane.id)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent/40"
          >
            Start terminal
          </button>
        </div>
      </div>
    )
  }
  return (
    <div onMouseDown={onFocus} className="h-full">
      <TerminalView
        sessionId={pane.id}
        isActive={isTabActive && tab.activePaneId === pane.id}
        onTitleChange={(title) => onTitleChange?.(tab.id, pane.id, title)}
      />
    </div>
  )
}

function TerminalTabContent({
  tab,
  isActive,
  onTitleChange,
  onStartTerminal,
  onClosePane,
  onFocusPane,
}: {
  tab: TerminalTab
  isActive: boolean
  onTitleChange?: (tabId: string, paneId: string, title: string) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onClosePane?: (tabId: string, paneId: string) => void
  onFocusPane?: (tabId: string, paneId: string) => void
}) {
  const multi = tab.panes.length > 1

  const renderPane = (pane: TerminalPaneType) => (
    <div
      className={cn(
        "group/pane relative h-full",
        multi &&
          tab.activePaneId === pane.id &&
          "ring-1 ring-inset ring-foreground/15",
      )}
    >
      <TerminalPaneView
        tab={tab}
        pane={pane}
        isTabActive={isActive}
        onTitleChange={onTitleChange}
        onStartTerminal={onStartTerminal}
        onFocus={() => onFocusPane?.(tab.id, pane.id)}
      />
    </div>
  )

  // Always render through ResizablePanelGroup — even with a single pane — so
  // splitting from 1→2 panes doesn't change the parent structure and force an
  // unmount/remount of the existing terminal (which causes a visible flicker).
  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      {tab.panes.map((pane, idx) => (
        <Fragment key={pane.id}>
          {idx > 0 && <ResizableHandle />}
          <ResizablePanel
            id={pane.id}
            order={idx}
            minSize={10}
            defaultSize={100 / tab.panes.length}
          >
            {renderPane(pane)}
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  )
}

function PaneContent({
  tab,
  project,
  isActive,
  diffViewMode,
  onTitleChange,
  onStartTerminal,
  onSplitTerminal,
  onClosePane,
  onFocusPane,
}: {
  tab: WorkspaceTab
  project: Project
  isActive: boolean
  diffViewMode: "unified" | "split"
  onTitleChange?: (tabId: string, paneId: string, title: string) => void
  onStartTerminal?: (tabId: string, paneId: string) => void
  onSplitTerminal?: (tabId: string) => void
  onClosePane?: (tabId: string, paneId: string) => void
  onFocusPane?: (tabId: string, paneId: string) => void
}) {
  if (tab.kind === "terminal") {
    return (
      <TerminalTabContent
        tab={tab}
        isActive={isActive}
        onTitleChange={onTitleChange}
        onStartTerminal={onStartTerminal}
        onClosePane={onClosePane}
        onFocusPane={onFocusPane}
      />
    )
  }
  if (tab.kind === "diff") {
    return (
      <SingleFileDiff
        cwd={project.path}
        path={tab.path}
        staged={tab.staged}
        viewMode={diffViewMode}
      />
    )
  }
  return <FilePreview cwd={project.path} path={tab.path} />
}

export function WorkspacePane({
  project,
  isActive = true,
  onTitleChange,
  onStartTerminal,
  onSplitTerminal,
  onClosePane,
  onFocusPane,
}: Props) {
  const activeTab = project?.tabs.find((t) => t.id === project.activeTabId)
  const isTerminalActive = activeTab?.kind === "terminal"
  const isDiffActive = activeTab?.kind === "diff"

  // Per-diff-tab view mode, remembered while the tab exists; defaults to the
  // last-persisted mode so the user's choice survives restarts.
  const [defaultDiffMode, setDefaultDiffMode] = useState<"unified" | "split">(
    () => loadDiffViewMode(),
  )
  const [diffViewModes, setDiffViewModes] = useState<
    Record<string, "unified" | "split">
  >({})
  const activeDiffMode =
    (activeTab && diffViewModes[activeTab.id]) || defaultDiffMode

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <span className="truncate">
          {activeTab
            ? tabDisplayName(activeTab)
            : project
              ? "No tab"
              : "No project"}
        </span>
        {isDiffActive && activeTab && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => {
                    const next =
                      activeDiffMode === "unified" ? "split" : "unified"
                    setDiffViewModes((prev) => ({
                      ...prev,
                      [activeTab.id]: next,
                    }))
                    setDefaultDiffMode(next)
                    saveDiffViewMode(next)
                  }}
                  aria-label={
                    activeDiffMode === "unified"
                      ? "Switch to split diff"
                      : "Switch to inline diff"
                  }
                  className="ml-auto grid size-6 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground"
                >
                  {activeDiffMode === "unified" ? (
                    <Columns2 className="size-3.5" />
                  ) : (
                    <Rows3 className="size-3.5" />
                  )}
                </button>
              }
            />
            <TooltipContent>
              {activeDiffMode === "unified" ? "Split diff" : "Inline diff"}
            </TooltipContent>
          </Tooltip>
        )}
        {isTerminalActive && onSplitTerminal && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => onSplitTerminal(activeTab!.id)}
                  aria-label="Split terminal"
                  className="ml-auto grid size-6 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/15 hover:text-foreground"
                >
                  <SplitSquareHorizontal className="size-3.5" />
                </button>
              }
            />
            <TooltipContent>Split terminal (⌘D)</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="relative flex-1">
        {project?.tabs.map((t) => (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              t.id !== project.activeTabId && "invisible pointer-events-none",
            )}
          >
            <PaneContent
              tab={t}
              project={project}
              isActive={isActive && t.id === project.activeTabId}
              diffViewMode={diffViewModes[t.id] ?? defaultDiffMode}
              onTitleChange={onTitleChange}
              onStartTerminal={onStartTerminal}
              onSplitTerminal={onSplitTerminal}
              onClosePane={onClosePane}
              onFocusPane={onFocusPane}
            />
          </div>
        ))}
        {project && project.tabs.length === 0 && (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            No terminals — click + to open one
          </div>
        )}
        {!project && (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            No project open
          </div>
        )}
      </div>
    </div>
  )
}
