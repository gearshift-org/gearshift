import type {
  AppApi,
  AppWindowApi,
  ClipboardApi,
  DialogApi,
  ElectronUtils,
  FsApi,
  GitApi,
  MenuApi,
  ShellApi,
  StateApi,
  TermApi,
} from "../../electron/preload"

declare global {
  interface Window {
    dialogApi: DialogApi
    shellApi: ShellApi
    term: TermApi
    clipboardApi: ClipboardApi
    electronUtils: ElectronUtils
    appApi: AppApi
    appWindow: AppWindowApi
    git: GitApi
    fsApi: FsApi
    stateApi?: StateApi
    menuApi?: MenuApi
  }
}

export {}
