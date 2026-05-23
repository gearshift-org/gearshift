import { useEffect, useState } from "react"
import { useTheme } from "@/components/theme-provider"
import { DiffViewer } from "./DiffViewer"

type Props = {
  cwd: string
  path: string
  staged: boolean
  viewMode?: "unified" | "split"
}

export function SingleFileDiff({
  cwd,
  path,
  staged,
  viewMode = "unified",
}: Props) {
  const { resolvedTheme } = useTheme()
  const [patch, setPatch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    window.git
      .diffFile(cwd, path, staged)
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setError(res.error ?? "Failed to load diff")
          setPatch("")
        } else {
          setPatch(res.patch || "")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cwd, path, staged])

  // Listen for filesystem changes and re-fetch.
  useEffect(() => {
    const off = window.fsApi.onChanged((event) => {
      if (event.cwd !== cwd) return
      // Only refresh if our file is in the changed set (or no set provided).
      if (event.paths && !event.paths.some((p) => p.endsWith(path))) return
      window.git.diffFile(cwd, path, staged).then((res) => {
        if (res.ok) setPatch(res.patch || "")
      })
    })
    return off
  }, [cwd, path, staged])

  if (loading && !patch) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        Loading diff…
      </div>
    )
  }
  if (error) {
    return (
      <div className="grid h-full place-items-center text-xs text-red-500">
        {error}
      </div>
    )
  }
  if (!patch.trim()) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        No changes
      </div>
    )
  }

  return (
    <DiffViewer patch={patch} themeType={resolvedTheme} viewMode={viewMode} />
  )
}
