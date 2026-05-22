import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { TerminalPane } from "./TerminalPane"
import { ChangesPane } from "./ChangesPane"
import type { Project } from "./types"

type Props = {
  project: Project | undefined
  onTerminalTitleChange?: (terminalId: string, title: string) => void
  onStartTerminal?: (tabId: string) => void
}

export function WorkspaceSplit({
  project,
  onTerminalTitleChange,
  onStartTerminal,
}: Props) {
  return (
    <ResizablePanelGroup orientation="horizontal" className="flex-1">
      <ResizablePanel defaultSize={50} minSize={25}>
        <TerminalPane
          project={project}
          onTitleChange={onTerminalTitleChange}
          onStartTerminal={onStartTerminal}
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={50} minSize={25}>
        <ChangesPane />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
