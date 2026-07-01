import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { FileDiff, FolderGit2, MonitorPlay, TerminalSquare } from "lucide-react"
import Fuse from "fuse.js"
import type { IFuseOptions } from "fuse.js"
import { FileIcon } from "@/components/icons/FileIcon"
import {
  Fragment,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { shortenHomePath } from "@/lib/pathDisplay"
import type { PaletteRecents } from "@/lib/projects"
import { tabDisplayName } from "./terminalName"
import type { Project, WorkspaceTab } from "./types"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: Project[]
  activeProject: Project | undefined
  paletteRecents: PaletteRecents
  onSelectProject: (id: string) => void
  onSelectTab: (id: string) => void
  onOpenFile: (path: string, line?: number) => void
}

const MAX_FILE_RESULTS = 20
const MIN_CONTENT_QUERY = 2
const CONTENT_SEARCH_DEBOUNCE_MS = 150

type ContentMatch = { path: string; line: number; text: string }

type FileEntry = {
  path: string
  name: string
  compactPath: string
  compactPluralPath: string
}

// Weight the basename higher than the full path so filename matches win, and
// ignore match location so a match anywhere in the path counts (VS Code style).
const FUSE_OPTIONS: IFuseOptions<FileEntry> = {
  keys: [
    { name: "name", weight: 0.45 },
    { name: "path", weight: 0.25 },
    { name: "compactPath", weight: 0.2 },
    { name: "compactPluralPath", weight: 0.1 },
  ],
  ignoreLocation: true,
  threshold: 0.4,
  minMatchCharLength: 1,
  includeScore: true,
}

// Fuse score is 0 (perfect) … 1 (worst). A filename match at or below this is a
// "strong" hit that should outrank content matches; weaker (higher) scores mean
// the file only fuzzily matched, so exact content hits take priority instead.
const STRONG_FILE_SCORE = 0.1

function tabIcon(t: WorkspaceTab) {
  if (t.kind === "diff") return <FileDiff />
  if (t.kind === "file")
    return <FileIcon name={t.path.split("/").pop() ?? t.path} />
  if (t.kind === "devPreview") return <MonitorPlay />
  return <TerminalSquare />
}

function terminalSessionIds(t: WorkspaceTab): string[] {
  if (t.kind !== "terminal") return []
  return t.panes.flatMap((pane) => (pane.sessionId ? [pane.sessionId] : []))
}

function tabCommandValue(t: WorkspaceTab): string {
  return `tab ${t.kind} ${t.id} ${terminalSessionIds(t).join(" ")}`
}

function tabCommandKeywords(t: WorkspaceTab): string[] {
  const title = tabDisplayName(t)
  if (t.kind === "diff" || t.kind === "file") return [title, t.path]
  if (t.kind === "devPreview") return [title, t.url]
  return [title, ...terminalSessionIds(t)]
}

function recencyIndex(recents: string[], value: string): number {
  const index = recents.indexOf(value)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function searchSegments(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? []
}

function pluralizeSearchSegment(value: string): string {
  return value.endsWith("s") ? value : `${value}s`
}

function compactSearchValue(value: string): string {
  return searchSegments(value).join("")
}

function fileEntry(path: string): FileEntry {
  const name = path.split("/").pop() ?? path
  const segments = searchSegments(path)
  return {
    path,
    name,
    compactPath: segments.join(""),
    compactPluralPath: segments.map(pluralizeSearchSegment).join(""),
  }
}

function fileNameRank(
  entry: FileEntry,
  query: string,
  compactQuery: string
): number {
  const name = entry.name.toLowerCase()
  const path = entry.path.toLowerCase()
  const compactName = compactSearchValue(entry.name)
  const queryInNameAt = name.indexOf(query)
  const compactQueryInNameAt = compactQuery
    ? compactName.indexOf(compactQuery)
    : -1

  let rank = 100_000

  if (name === query) rank = 0
  else if (name.startsWith(query)) rank = 1_000
  else if (queryInNameAt >= 0) rank = 2_000 + queryInNameAt
  else if (compactName === compactQuery) rank = 3_000
  else if (compactQueryInNameAt === 0) rank = 4_000
  else if (compactQueryInNameAt > 0) rank = 5_000 + compactQueryInNameAt
  else if (path.includes(query)) rank = 6_000 + path.indexOf(query)
  else if (entry.compactPath.includes(compactQuery)) {
    rank = 7_000 + entry.compactPath.indexOf(compactQuery)
  } else if (entry.compactPluralPath.includes(compactQuery)) {
    rank = 8_000 + entry.compactPluralPath.indexOf(compactQuery)
  }

  // Prefer the closest, shortest filename when match quality is otherwise tied.
  // Example: `console.php` should beat many `app/Console/...` files for
  // queries like `console` or `console.php`.
  return rank + entry.name.length / 1_000 + entry.path.length / 1_000_000
}

function rankFileEntries(
  entries: FileEntry[],
  query: string,
  compactQuery: string
): FileEntry[] {
  return entries.slice().sort((a, b) => {
    const rankDiff =
      fileNameRank(a, query, compactQuery) -
      fileNameRank(b, query, compactQuery)
    if (rankDiff !== 0) return rankDiff
    return a.path.localeCompare(b.path)
  })
}

export function CommandPalette({
  open,
  onOpenChange,
  projects,
  activeProject,
  paletteRecents,
  onSelectProject,
  onSelectTab,
  onOpenFile,
}: Props) {
  const [files, setFiles] = useState<string[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [contentMatches, setContentMatches] = useState<ContentMatch[]>([])
  const [query, setQuery] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  // Defer the query so typing stays responsive while the large file list
  // re-filters in a lower-priority render pass.
  const deferredQuery = useDeferredValue(query)
  const projectPath = activeProject?.path

  // Lazy-load the project file list on first open / project change. Clear
  // stale results synchronously so switching projects never flashes the prior
  // project's files in the palette.
  useEffect(() => {
    if (!open || !projectPath) {
      setFiles([])
      return
    }
    let cancelled = false
    setFiles([])
    setFilesLoading(true)
    window.fsApi.listAllFiles(projectPath).then((res) => {
      if (cancelled) return
      setFiles(res.ok ? res.files : [])
      setFilesLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, projectPath])

  // Reset the query when the palette closes so reopening starts fresh.
  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const qLower = deferredQuery.trim().toLowerCase()

  // When the search changes, cmdk keeps the current scroll position. Move the
  // results back to the top so the best matches are visible first.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 })
  }, [qLower])

  // Debounced content (in-file) search via `git grep`. Runs only for queries of
  // at least MIN_CONTENT_QUERY chars and cancels stale/in-flight requests so the
  // results always reflect the latest query.
  useEffect(() => {
    if (!open || !projectPath || qLower.length < MIN_CONTENT_QUERY) {
      setContentMatches([])
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      window.fsApi.searchContents(projectPath, qLower).then((res) => {
        if (cancelled) return
        setContentMatches(res.ok ? res.results : [])
      })
    }, CONTENT_SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [open, projectPath, qLower])

  const filteredTabs = useMemo(() => {
    const tabs = activeProject?.tabs ?? []
    const recentTabs =
      paletteRecents.tabsByProject[activeProject?.path ?? ""] ?? []
    const byRecency = (items: WorkspaceTab[]) =>
      items
        .slice()
        .sort(
          (a, b) =>
            recencyIndex(recentTabs, a.id) - recencyIndex(recentTabs, b.id)
        )
    if (!qLower) return byRecency(tabs)
    return byRecency(
      tabs.filter((t) => {
        const hay = (
          tabDisplayName(t) +
          " " +
          (t.kind === "diff" || t.kind === "file"
            ? t.path
            : t.kind === "devPreview"
              ? t.url
              : "")
        ).toLowerCase()
        return hay.includes(qLower)
      })
    )
  }, [
    activeProject?.path,
    activeProject?.tabs,
    paletteRecents.tabsByProject,
    qLower,
  ])

  const filteredProjects = useMemo(() => {
    const byRecency = (items: Project[]) =>
      items
        .slice()
        .sort(
          (a, b) =>
            recencyIndex(paletteRecents.projects, a.path) -
            recencyIndex(paletteRecents.projects, b.path)
        )
    if (!qLower) return byRecency(projects)
    return byRecency(
      projects.filter(
        (p) =>
          p.name.toLowerCase().includes(qLower) ||
          shortenHomePath(p.path).toLowerCase().includes(qLower)
      )
    )
  }, [paletteRecents.projects, projects, qLower])

  // Build the Fuse index once per file list (not per keystroke).
  const fileEntries = useMemo(() => files.map(fileEntry), [files])

  const fileFuse = useMemo(() => {
    return new Fuse(fileEntries, FUSE_OPTIONS)
  }, [fileEntries])

  const { filteredFiles, bestFileScore } = useMemo(() => {
    if (!files.length)
      return { filteredFiles: [] as string[], bestFileScore: 1 }
    const recentFiles =
      paletteRecents.filesByProject[activeProject?.path ?? ""] ?? []
    if (!qLower) {
      return {
        filteredFiles: files
          .slice()
          .sort(
            (a, b) =>
              recencyIndex(recentFiles, a) - recencyIndex(recentFiles, b)
          )
          .slice(0, MAX_FILE_RESULTS),
        bestFileScore: 0,
      }
    }
    const compactQuery = compactSearchValue(qLower)
    const compactMatches = compactQuery
      ? fileEntries.filter(
          (entry) =>
            entry.compactPath.includes(compactQuery) ||
            entry.compactPluralPath.includes(compactQuery)
        )
      : []
    // Fuse finds fuzzy candidates; then our light ranker makes close basename
    // matches and shorter filenames win over broad path matches.
    const seen = new Set<string>()
    const candidates = [
      ...compactMatches,
      ...fileFuse
        .search(qLower, { limit: MAX_FILE_RESULTS * 3 })
        .map((r) => r.item),
    ].filter((entry) => {
      if (seen.has(entry.path)) return false
      seen.add(entry.path)
      return true
    })
    const rankedFiles = rankFileEntries(candidates, qLower, compactQuery).slice(
      0,
      MAX_FILE_RESULTS
    )
    const results = rankedFiles.filter(
      (entry) => !compactMatches.some((match) => match.path === entry.path)
    )
    return {
      filteredFiles: rankedFiles.map((entry) => entry.path),
      bestFileScore: compactMatches.length
        ? 0
        : results.length
          ? (fileFuse.search(qLower, { limit: 1 })[0]?.score ?? 1)
          : 1,
    }
  }, [
    activeProject?.path,
    fileEntries,
    files,
    fileFuse,
    paletteRecents.filesByProject,
    qLower,
  ])

  // Show content hits above files when the files only matched weakly (e.g. a
  // word that happens to appear in a path) but the contents match the full query.
  const contentsFirst =
    contentMatches.length > 0 &&
    (filteredFiles.length === 0 || bestFileScore > STRONG_FILE_SCORE)

  const filteredTerminalTabs = filteredTabs.filter((t) => t.kind === "terminal")
  const filteredDiffTabs = filteredTabs.filter((t) => t.kind === "diff")
  const filteredFileTabs = filteredTabs.filter((t) => t.kind === "file")
  const hasOpenTabResults = filteredTabs.length > 0

  // cmdk only auto-highlights the first item when its own filter runs; since we
  // disabled that (shouldFilter={false}), control the selection ourselves and
  // reset it to the topmost item whenever the result set changes.
  const firstItemValue = useMemo(() => {
    if (filteredProjects.length > 0) {
      const p = filteredProjects[0]
      return `project ${p.name} ${p.path}`
    }
    const firstTab =
      filteredTerminalTabs[0] ?? filteredDiffTabs[0] ?? filteredFileTabs[0]
    if (firstTab) return tabCommandValue(firstTab)
    const fileValue = filteredFiles.length > 0 ? `file ${filteredFiles[0]}` : ""
    const contentValue =
      contentMatches.length > 0
        ? `content ${contentMatches[0].path}:${contentMatches[0].line}:0`
        : ""
    if (contentsFirst) return contentValue || fileValue
    return fileValue || contentValue
  }, [
    contentMatches,
    contentsFirst,
    filteredDiffTabs,
    filteredFileTabs,
    filteredFiles,
    filteredProjects,
    filteredTerminalTabs,
  ])

  const [selectedValue, setSelectedValue] = useState("")
  useEffect(() => {
    setSelectedValue(firstItemValue)
  }, [firstItemValue])

  const run = (fn: () => void) => {
    fn()
    onOpenChange(false)
  }

  const renderTabItems = (tabs: WorkspaceTab[]) =>
    tabs.map((t) => {
      const title = tabDisplayName(t)
      return (
        <CommandItem
          key={t.id}
          value={tabCommandValue(t)}
          keywords={tabCommandKeywords(t)}
          onSelect={() => run(() => onSelectTab(t.id))}
        >
          {tabIcon(t)}
          <span className="truncate">{title}</span>
          {(t.kind === "diff" || t.kind === "file") && (
            <span className="ml-auto truncate text-xs text-muted-foreground">
              {shortenHomePath(t.path)}
            </span>
          )}
        </CommandItem>
      )
    })

  const filesGroup =
    activeProject && filteredFiles.length > 0 ? (
      <CommandGroup heading="Files">
        {filteredFiles.map((f) => (
          <CommandItem
            key={f}
            value={`file ${f}`}
            onSelect={() => run(() => onOpenFile(f))}
          >
            <FileIcon name={f.split("/").pop() ?? f} />
            <span className="truncate">{f.split("/").pop()}</span>
            <span className="ml-auto truncate text-xs text-muted-foreground">
              {shortenHomePath(f)}
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
    ) : null

  const contentsGroup =
    activeProject && contentMatches.length > 0 ? (
      <CommandGroup heading="Contents">
        {contentMatches.map((m, i) => (
          <CommandItem
            key={`content ${m.path}:${m.line}:${i}`}
            value={`content ${m.path}:${m.line}:${i}`}
            onSelect={() => run(() => onOpenFile(m.path, m.line))}
          >
            <FileIcon name={m.path.split("/").pop() ?? m.path} />
            <span className="truncate font-mono text-xs text-muted-foreground">
              {m.text}
            </span>
            <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground">
              {m.path.split("/").pop() ?? m.path}:{m.line}
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
    ) : null

  // Order the file vs content groups by relevance, then drop the empty ones.
  const fileContentGroups = (
    contentsFirst ? [contentsGroup, filesGroup] : [filesGroup, contentsGroup]
  ).filter(Boolean)

  return (
    // We do our own filtering/ranking (fuse.js for files, git grep for contents),
    // so cmdk's built-in filter is disabled to avoid double-filtering.
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      value={selectedValue}
      onValueChange={setSelectedValue}
    >
      <CommandInput
        placeholder="Type a command, file, tab, or project…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList ref={listRef}>
        <CommandEmpty>{filesLoading ? "Loading…" : "No matches."}</CommandEmpty>

        {filteredProjects.length > 0 && (
          <CommandGroup heading="Projects">
            {filteredProjects.map((p) => (
              <CommandItem
                key={p.id}
                value={`project ${p.name} ${p.path}`}
                onSelect={() => run(() => onSelectProject(p.id))}
              >
                <FolderGit2 />
                <span className="truncate">{p.name}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {shortenHomePath(p.path)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {hasOpenTabResults && (
          <>
            {filteredProjects.length > 0 && <CommandSeparator />}
            {filteredTerminalTabs.length > 0 && (
              <CommandGroup heading="Terminals">
                {renderTabItems(filteredTerminalTabs)}
              </CommandGroup>
            )}
            {filteredDiffTabs.length > 0 && (
              <CommandGroup heading="Diffs" className="border-t border-border">
                {renderTabItems(filteredDiffTabs)}
              </CommandGroup>
            )}
            {filteredFileTabs.length > 0 && (
              <CommandGroup heading="Open files">
                {renderTabItems(filteredFileTabs)}
              </CommandGroup>
            )}
          </>
        )}

        {fileContentGroups.map((group, i) => {
          const needsSeparator =
            i > 0 || filteredProjects.length > 0 || hasOpenTabResults
          return (
            <Fragment key={i}>
              {needsSeparator && <CommandSeparator />}
              {group}
            </Fragment>
          )
        })}
      </CommandList>
    </CommandDialog>
  )
}
