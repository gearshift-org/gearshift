import type {
  AppApi,
  ClipboardApi,
  DialogApi,
  ElectronUtils,
  TermApi,
} from "../../electron/preload"

declare global {
  interface Window {
    dialogApi: DialogApi
    term: TermApi
    clipboardApi: ClipboardApi
    electronUtils: ElectronUtils
    appApi: AppApi
  }
}

export {}
