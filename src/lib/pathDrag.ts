export const PATH_DRAG_MIME = "application/x-gearshift-path-list"

export function setPathDragData(dataTransfer: DataTransfer, paths: string[]) {
  const cleanPaths = paths.map((path) => path.trim()).filter(Boolean)
  if (cleanPaths.length === 0) return

  dataTransfer.effectAllowed = "copy"
  dataTransfer.setData(PATH_DRAG_MIME, JSON.stringify(cleanPaths))
  dataTransfer.setData("text/plain", cleanPaths.join("\n"))
}

export function getPathDragData(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return []

  const raw = dataTransfer.getData(PATH_DRAG_MIME)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((path): path is string => path.trim().length > 0)
  } catch {
    return []
  }
}

export function hasPathDragData(dataTransfer: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.types ?? []).includes(PATH_DRAG_MIME)
}
