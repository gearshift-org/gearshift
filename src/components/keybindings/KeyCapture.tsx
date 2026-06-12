import * as React from "react"
import {
  formatAccelerator,
  prettyAccelerator,
} from "@/lib/keybindings/registry"
import { Button } from "@/components/ui/button"

type Props = {
  initial?: string
  // Capture a modifier-only hold chord (e.g. "CmdOrCtrl+Alt") instead of a
  // keystroke. Press the modifiers together, then Enter/Save to confirm.
  modifiersOnly?: boolean
  onCommit: (accelerator: string) => void
  onCancel: () => void
}

export function KeyCapture({
  initial,
  modifiersOnly = false,
  onCommit,
  onCancel,
}: Props) {
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
    if (modifiersOnly) {
      const parts: string[] = []
      if (e.metaKey || e.ctrlKey) parts.push("CmdOrCtrl")
      if (e.altKey) parts.push("Alt")
      if (e.shiftKey) parts.push("Shift")
      if (!parts.includes("CmdOrCtrl")) {
        setHint("Must include Cmd or Ctrl")
        return
      }
      if (parts.length < 2) {
        // A single modifier (bare Cmd) would arm on every shortcut.
        setHint("Hold a second modifier (e.g. Option)")
        return
      }
      setHint(null)
      setCaptured(parts.join("+"))
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
        value={captured ?? ""}
        placeholder={
          modifiersOnly ? "Hold modifiers together…" : "Press a key combination…"
        }
        className="h-7 w-48 rounded-md border border-ring bg-background px-2 font-mono text-xs text-foreground ring-2 ring-ring/40 outline-none"
      />
      <span className="text-[11px] text-muted-foreground">
        {hint ?? "Press Enter or Save to confirm, Esc to cancel"}
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
      <Button
        type="button"
        size="sm"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => captured && !hint && onCommit(captured)}
        disabled={!captured || !!hint}
      >
        Save
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCancel}
      >
        Cancel
      </Button>
    </div>
  )
}
