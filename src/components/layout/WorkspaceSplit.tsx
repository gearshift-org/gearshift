import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { TerminalPane } from "./TerminalPane"
import { ChangesPane } from "./ChangesPane"
import type { TerminalTab } from "./types"

type Props = {
  terminal: TerminalTab | undefined
}

export function WorkspaceSplit({ terminal }: Props) {
  return (
    <ResizablePanelGroup orientation="horizontal" className="flex-1">
      <ResizablePanel defaultSize={50} minSize={25}>
        <TerminalPane terminal={terminal} />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={50} minSize={25}>
        <ChangesPane />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
