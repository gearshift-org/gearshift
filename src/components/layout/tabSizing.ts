import { useEffect, useState, type CSSProperties } from "react"

export const TAB_WIDTH_CLASS = "w-[220px] min-w-11 shrink"

export const TAB_LABEL_CLASS = "project-tab-label min-w-0 flex-1 truncate"

export const TAB_NAME_TOOLTIP_DELAY_MS = 700

export const TAB_OPEN_TRANSITION_CLASS =
  "transition-[width,min-width,padding] duration-150 ease-out"

export function useTabOpenAnimation(): {
  style: CSSProperties | undefined
  isOpening: boolean
} {
  const [isOpening, setIsOpening] = useState(true)
  useEffect(() => {
    const id = requestAnimationFrame(() => setIsOpening(false))
    return () => cancelAnimationFrame(id)
  }, [])
  return {
    isOpening,
    style: isOpening
      ? {
          width: 0,
          minWidth: 0,
          paddingLeft: 0,
          paddingRight: 0,
        }
      : undefined,
  }
}
