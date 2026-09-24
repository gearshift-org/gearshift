import type {
  AppApi,
  AppWindowApi,
  ClipboardApi,
  ClaudeChatApi,
  DialogApi,
  ElectronUtils,
  FsApi,
  GitApi,
  MenuApi,
  ShellApi,
  SpaceChatApi,
  StateApi,
  TermApi,
  UpdaterApi,
} from "../../electron/preload"

declare global {
  interface Window {
    dialogApi: DialogApi
    shellApi: ShellApi
    term: TermApi
    clipboardApi: ClipboardApi
    electronUtils: ElectronUtils
    appApi: AppApi
    spaceChat: SpaceChatApi
    claudeChat: ClaudeChatApi
    appWindow: AppWindowApi
    git: GitApi
    fsApi: FsApi
    stateApi?: StateApi
    menuApi?: MenuApi
    updaterApi?: UpdaterApi
  }
}

export {}
