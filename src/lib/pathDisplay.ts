export function shortenHomePath(path: string): string {
  const home = "/Users/"
  if (!path.startsWith(home)) return path

  const rest = path.slice(home.length)
  const slash = rest.indexOf("/")
  if (slash < 0) return path

  return `~${rest.slice(slash)}`
}
