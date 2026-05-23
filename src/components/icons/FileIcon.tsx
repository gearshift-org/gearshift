import { File, Folder, FolderOpen } from "lucide-react"
import { getFileIconUrl, getFolderIconUrl } from "@/lib/fileIcons"

type IconProps = {
  name: string
  className?: string
}

export function FileIcon({ name, className = "size-4 shrink-0" }: IconProps) {
  const url = getFileIconUrl(name)
  if (!url) return <File className={className} />
  return <img className={className} src={url} alt="" draggable={false} />
}

export function FolderIcon({
  name,
  open,
  className = "size-4 shrink-0",
}: IconProps & { open: boolean }) {
  const url = getFolderIconUrl(name, open)
  if (!url) {
    const Icon = open ? FolderOpen : Folder
    return <Icon className={className} />
  }
  return <img className={className} src={url} alt="" draggable={false} />
}
