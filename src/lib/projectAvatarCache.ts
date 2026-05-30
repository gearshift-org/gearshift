import { getProjectAvatarImagePath, getProjectAvatarImagePathMap } from "./projects"
import { store } from "./store"

const avatarUrlCache = new Map<string, string | null>()
const avatarUrlInflight = new Map<string, Promise<string | null>>()

export function getCachedProjectAvatarUrl(projectPath: string): string | null | undefined {
  return avatarUrlCache.get(projectPath)
}

export function clearCachedProjectAvatarUrl(projectPath: string): void {
  avatarUrlCache.delete(projectPath)
  avatarUrlInflight.delete(projectPath)
}

export async function loadProjectAvatarUrl(
  projectPath: string,
  force = false
): Promise<string | null> {
  if (!force && avatarUrlCache.has(projectPath)) {
    return avatarUrlCache.get(projectPath) ?? null
  }

  if (!force) {
    const inflight = avatarUrlInflight.get(projectPath)
    if (inflight) return inflight
  }

  const next = (async () => {
    await store.whenReady()
    const imagePath = getProjectAvatarImagePath(projectPath)
    if (!imagePath || !window.fsApi) {
      avatarUrlCache.set(projectPath, null)
      return null
    }

    const res = await window.fsApi.readImage(imagePath)
    const url = res.ok && res.dataUrl ? res.dataUrl : null
    avatarUrlCache.set(projectPath, url)
    return url
  })()

  avatarUrlInflight.set(projectPath, next)
  try {
    return await next
  } finally {
    avatarUrlInflight.delete(projectPath)
  }
}

export async function preloadProjectAvatarImages(): Promise<void> {
  await store.whenReady()
  const avatars = getProjectAvatarImagePathMap()
  await Promise.all(Object.keys(avatars).map((path) => loadProjectAvatarUrl(path)))
}
