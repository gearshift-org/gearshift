import type {
  AppApi,
  ClipboardApi,
  DialogApi,
  ElectronUtils,
  FsApi,
  GitApi,
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
    git: GitApi
    fsApi: FsApi
    stateApi?: StateApi
  }
}

export {}
