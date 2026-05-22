export type TerminalTab = {
  id: string
  name: string
}

export type Project = {
  id: string
  name: string
  terminals: TerminalTab[]
  activeTerminalId: string
}
