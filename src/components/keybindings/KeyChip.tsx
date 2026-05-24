import * as React from "react"
import { prettyAccelerator } from "@/lib/keybindings/registry"

type Props = {
  accelerator: string
  className?: string
}

export function KeyChip({ accelerator, className }: Props) {
  const parts = prettyAccelerator(accelerator)
  return (
    <span className={`inline-flex items-center gap-0.5 ${className ?? ""}`}>
      {parts.map((p, i) => (
        <kbd
          key={`${p}-${i}`}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[11px] leading-none text-foreground"
        >
          {p}
        </kbd>
      ))}
    </span>
  )
}
