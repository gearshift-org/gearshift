import { useEffect, useState } from "react"
import {
  clearCachedProjectAvatarUrl,
  getCachedProjectAvatarUrl,
  loadProjectAvatarUrl,
} from "@/lib/projectAvatarCache"
import {
  PROJECT_AVATAR_CHANGED_EVENT,
  getProjectAvatarImagePath,
  getProjectColor,
} from "@/lib/projects"
import { store } from "@/lib/store"
import { cn } from "@/lib/utils"

function projectInitials(name: string): string {
  const cleaned = name.replace(/[._-]+/g, " ").trim()
  if (!cleaned) return "?"
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  const w = words[0]
  return (w.length === 1 ? w[0] : w.slice(0, 2)).toUpperCase()
}

/** Choose black or white text using the background luminance. */
function readableTextOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? "#000000" : "#ffffff"
}

type ProjectAvatarProps = {
  name: string
  path: string
  className?: string
}

export function ProjectAvatar({ name, path, className }: ProjectAvatarProps) {
  const bg = getProjectColor(path)
  const cachedAvatarUrl = getCachedProjectAvatarUrl(path)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    cachedAvatarUrl ?? null
  )
  const [avatarChecked, setAvatarChecked] = useState(
    () =>
      cachedAvatarUrl !== undefined ||
      (store.isReady() && !getProjectAvatarImagePath(path))
  )

  useEffect(() => {
    let cancelled = false

    const loadAvatar = (force = false) => {
      const cached = !force ? getCachedProjectAvatarUrl(path) : undefined
      if (cached !== undefined) {
        setAvatarUrl(cached)
        setAvatarChecked(true)
        return
      }

      if (!store.isReady()) {
        setAvatarChecked(false)
        return
      }

      if (!getProjectAvatarImagePath(path)) {
        setAvatarUrl(null)
        setAvatarChecked(true)
        return
      }

      setAvatarChecked(false)
      loadProjectAvatarUrl(path, force).then((url) => {
        if (cancelled) return
        setAvatarUrl(url)
        setAvatarChecked(true)
      })
    }

    loadAvatar()
    const onAvatarChanged = (event: Event) => {
      const changedPath = (event as CustomEvent<{ path?: string }>).detail?.path
      if (!changedPath || changedPath === path) {
        clearCachedProjectAvatarUrl(path)
        loadAvatar(true)
      }
    }
    window.addEventListener(PROJECT_AVATAR_CHANGED_EVENT, onAvatarChanged)
    const offReady = store.onReady(loadAvatar)

    return () => {
      cancelled = true
      window.removeEventListener(PROJECT_AVATAR_CHANGED_EVENT, onAvatarChanged)
      offReady()
    }
  }, [path])

  return (
    <span
      aria-hidden
      style={{
        backgroundColor: avatarChecked && !avatarUrl ? bg : "transparent",
        color: readableTextOn(bg),
      }}
      className={cn(
        "grid size-4 shrink-0 place-items-center overflow-hidden rounded-[3px] text-[9px] leading-none font-semibold",
        className
      )}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="size-full object-cover" />
      ) : avatarChecked ? (
        projectInitials(name)
      ) : null}
    </span>
  )
}
