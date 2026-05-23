import { useEffect, useMemo, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"

type Props = {
  cwd: string
  /** Path relative to project root. */
  path: string
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "too-large"; size: number }
  | { kind: "binary" }
  | { kind: "error"; message: string }

function joinPath(cwd: string, rel: string): string {
  if (rel.startsWith("/")) return rel
  return `${cwd.replace(/\/+$/, "")}/${rel}`
}

export function FilePreview({ cwd, path }: Props) {
  const abs = useMemo(() => joinPath(cwd, path), [cwd, path])
  const [state, setState] = useState<LoadState>({ kind: "loading" })

  useEffect(() => {
    let cancelled = false
    setState({ kind: "loading" })
    window.fsApi.readFile(abs).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setState({ kind: "error", message: res.error ?? "Failed to read file" })
      } else if (res.tooLarge) {
        setState({ kind: "too-large", size: res.size ?? 0 })
      } else if (res.binary) {
        setState({ kind: "binary" })
      } else {
        setState({ kind: "ready", content: res.content ?? "" })
      }
    })
    return () => {
      cancelled = true
    }
  }, [abs])

  if (state.kind === "loading") {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        Loading…
      </div>
    )
  }
  if (state.kind === "too-large") {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        File too large to preview ({Math.round(state.size / 1024)} KB).
      </div>
    )
  }
  if (state.kind === "binary") {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        Binary file
      </div>
    )
  }
  if (state.kind === "error") {
    return (
      <div className="grid h-full place-items-center text-xs text-red-500">
        {state.message}
      </div>
    )
  }

  return (
    <ScrollArea className="h-full bg-card">
      <pre className="m-0 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre">
        {state.content}
      </pre>
    </ScrollArea>
  )
}
