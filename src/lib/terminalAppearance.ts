import * as React from "react"
import { store } from "@/lib/store"

const STORAGE_KEY = "gearshift.terminalAppearance"
const CHANGE = "change"
const bus = new EventTarget()

export const DEFAULT_TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
export const DEFAULT_TERMINAL_FONT_SIZE = 13

export type TerminalAppearance = {
  fontFamily: string
  fontSize: number
}

function readAppearance(): TerminalAppearance {
  const fallback = {
    fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize: DEFAULT_TERMINAL_FONT_SIZE,
  }
  const raw = store.get(STORAGE_KEY)
  if (!raw) return fallback

  try {
    const parsed = JSON.parse(raw) as Partial<TerminalAppearance>
    return {
      fontFamily:
        typeof parsed.fontFamily === "string" && parsed.fontFamily.trim()
          ? parsed.fontFamily
          : fallback.fontFamily,
      fontSize:
        typeof parsed.fontSize === "number" && Number.isFinite(parsed.fontSize)
          ? clampFontSize(parsed.fontSize)
          : fallback.fontSize,
    }
  } catch {
    return fallback
  }
}

function writeAppearance(next: TerminalAppearance) {
  store.set(STORAGE_KEY, JSON.stringify(next))
  bus.dispatchEvent(new Event(CHANGE))
}

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_TERMINAL_FONT_SIZE
  return Math.min(32, Math.max(8, Math.round(size)))
}

export function useTerminalAppearance() {
  const [appearance, setAppearanceState] = React.useState<TerminalAppearance>(() =>
    readAppearance(),
  )

  React.useEffect(() => {
    const off = store.onReady(() => setAppearanceState(readAppearance()))
    return off
  }, [])

  React.useEffect(() => {
    const onChange = () => setAppearanceState(readAppearance())
    bus.addEventListener(CHANGE, onChange)
    return () => bus.removeEventListener(CHANGE, onChange)
  }, [])

  const setFontFamily = React.useCallback((fontFamily: string) => {
    writeAppearance({ ...readAppearance(), fontFamily })
  }, [])

  const setFontSize = React.useCallback((fontSize: number) => {
    writeAppearance({ ...readAppearance(), fontSize: clampFontSize(fontSize) })
  }, [])

  const resetFontFamily = React.useCallback(() => {
    writeAppearance({
      ...readAppearance(),
      fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    })
  }, [])

  const resetFontSize = React.useCallback(() => {
    writeAppearance({ ...readAppearance(), fontSize: DEFAULT_TERMINAL_FONT_SIZE })
  }, [])

  return {
    appearance,
    setFontFamily,
    setFontSize,
    resetFontFamily,
    resetFontSize,
  }
}
