import { getProjectColor } from "@/lib/projects"
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

/** Pick black or white text based on the background's perceived luminance. */
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

  return (
    <span
      aria-hidden
      style={{ backgroundColor: bg, color: readableTextOn(bg) }}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[3px] text-[9px] leading-none font-semibold",
        className
      )}
    >
      {projectInitials(name)}
    </span>
  )
}
