import * as React from "react"
import { formatAccelerator, prettyAccelerator } from "@/lib/keybindings/registry"

type Props = {
  initial?: string
  onCommit: (accelerator: string) => void
  onCancel: () => void
}

export function KeyCapture({ initial, onCommit, onCancel }: Props) {
  const [captured, setCaptured] = React.useState<string | null>(initial ?? null)
  const [hint, setHint] = React.useState<string | null>(null)
  const ref = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    ref.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === "Escape") {
      onCancel()
      return
    }
    if (e.key === "Enter") {
      if (captured) onCommit(captured)
      return
    }
    const acc = formatAccelerator(e.nativeEvent)
    if (!acc) return
    if (!e.metaKey && !e.ctrlKey) {
      setHint("Must include Cmd or Ctrl")
      return
    }
    setHint(null)
    setCaptured(acc)
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={ref}
        readOnly
        data-keycapture="true"
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        value={captured ?? ""}
        placeholder="Press a key combination…"
        className="h-7 w-48 rounded-md border border-ring bg-background px-2 font-mono text-xs text-foreground outline-none ring-2 ring-ring/40"
      />
      <span className="text-[11px] text-muted-foreground">
        {hint ?? "Press Enter to confirm, Esc to cancel"}
      </span>
      {captured && !hint ? (
        <span className="inline-flex items-center gap-0.5">
          {prettyAccelerator(captured).map((p, i) => (
            <kbd
              key={`${p}-${i}`}
              className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[11px] leading-none text-foreground"
            >
              {p}
            </kbd>
          ))}
        </span>
      ) : null}
    </div>
  )
}
