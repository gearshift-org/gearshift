# Architecture

This document explains the main runtime systems in GearShift.

## Filesystem Watcher

Each open project subscribes to a recursive native watcher via [`@parcel/watcher`](https://www.npmjs.com/package/@parcel/watcher) in `electron/main.ts`. One subscription is created per `watchId`, keyed off a renderer request from `fs:watchProject`.

The watcher is intentionally noisy at the OS level but quiet at the IPC level:

- Ignored at the source: only base globs like `**/.git/**` and `**/.DS_Store`. Project `.gitignore` rules are not ignored by the watcher because the file tree still shows gitignored files and must refresh when they change.
- Debounced in main: events are collected into a `Set<string>` per watch and flushed after 150 ms as one `fs:changed` IPC event.
- Native module handling: `@parcel/watcher` is marked external in `vite.config.ts` so the bundler does not inline its prebuilt binaries.

## Git Panel Refresh

The right sidebar's Git tab keeps `git status` and diffs in sync with disk using four paths:

1. Initial load on mount, `cwd` change, and active project change.
2. Watcher-driven refresh after `fs:changed` IPC events.
3. Polling backstop for file changes missed by the watcher.
4. Immediate React Query refetch when a terminal agent transitions from working to completed.

All refresh requests funnel through one serialized callback so concurrent refreshes do not stack. Inactive projects skip watcher subscriptions and polling to keep background work low.

Stage, unstage, and discard actions optimistically patch the visible changes list immediately. Watcher and polling refreshes are held during the action, and the optimistic overlay is only removed after a real `git status` refresh confirms the new state, so stale in-flight refreshes cannot flash a file back to the old section.

## CLI Agent Activity

Terminal panes detect supported coding agents by asking the Electron main process to inspect the PTY shell's child process tree. GearShift passes each terminal a `GEARSHIFT_SESSION_ID` and `GEARSHIFT_AGENT_SOCKET` so supported lifecycle hooks can report status back over a local Unix socket. Agent-specific hooks and plugins are normalized into GearShift lifecycle events: `start`, `stop`, `needs_attention`, and (Claude and Grok) `subagent_start`/`subagent_stop`. Claude's `Stop` hook fires whenever the main agent finishes a turn, even while background subagents are still running, so GearShift tracks subagent lifecycles and holds the "completed" notification until the last pending background subagent has stopped; Grok's parallel subagents get the same treatment.

Display code derives a single semantic state from runtime flags: `blocked`, `working`, `done`, `idle`, or `unknown`. The priority is `blocked > working > done > idle > unknown`, so a pane or project that needs input wins over normal progress. Hooks remain authoritative for normal `working`/`done` lifecycle while active or recent, but strong blocked-prompt cues can override a working hook when an agent asks inline questions without firing a dedicated attention hook. If hooks are missing or stale, strong terminal title/output cues provide a fallback for Codex, Claude, and OpenCode: title spinners mean `working`, Codex "Action Required", permission prompts, and OpenCode question menus mean `blocked`, and a return to a known idle title after fallback work marks the turn `done`.

The renderer combines lifecycle hooks, process detection, terminal title changes, and terminal output cues to show project-level activity. Background completions can surface as desktop notifications or as in-app notification cards, which can be disabled in Settings → General without affecting desktop notifications. The count of unviewed completed agents is mirrored as a red badge on the dock icon (cleared as the flagged panes are viewed). For pi, GearShift also wraps interactive `ctx.ui` prompts so post-turn menus like plan approval report `needs_attention` instead of a completed state.

### Agent status persistence (session-scoped)

All agent statuses (`blocked`, `working`, `done`, `idle`) are tied to a live terminal PTY session. A small subset is saved in the project snapshot so markers can survive an app quit/refresh **only while that session is still alive** (daemon session id present):

| Field                                                          | Persists across restart?                                 | Notes                                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `completed` / `completedAt` / `lastSubmitAt` / `workStartedAt` | Only with an active terminal session                     | Entire subset dropped when the session exits, is killed, fails adopt, or the pane/tab is closed |
| Project `agentDone`                                            | Only when some pane still has session-backed `completed` | Cleared whenever no completed pane remains                                                      |
| Project `agentNeedsAttention`                                  | No (live-only)                                           | Also cleared at runtime when no pane is still blocked                                           |
| `running` / `working` / `needsAttention` / `agentName`         | No                                                       | Re-detected from the live PTY / hooks; wiped with the pane when the session stops               |

So a refresh with a live daemon session can still show "done" or the last-submit badge, but stopping or removing the terminal clears **every** project/pane agent status marker for that session — not just completion.

### Supported agents

GearShift treats coding-agent CLIs in two tiers:

| Tier             | Agents                      | Tab-bar launcher                       | Lifecycle hooks                                      | Session title / resume                |
| ---------------- | --------------------------- | -------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| **Full**         | Claude, Codex, OpenCode, pi | Yes (Settings → Agents launch options) | Yes (`electron/agentHooks.ts`)                       | Yes (`electron/agentSessionTitle.ts`) |
| **Runtime-only** | Grok Build CLI (`grok`)     | No — start manually in a shell         | Yes (`installGrokHooks` in `electron/agentHooks.ts`) | No                                    |

Full-tier agents are listed in `AGENT_TERMINAL_NAMES` (`src/lib/agentTerminalOptions.ts`) and can be spawned from the workspace tab bar. Runtime-only agents are recognized while their process is running in a pane, but are intentionally omitted from that launcher.

### Grok Build CLI (runtime-only)

Grok is Claude Code–compatible and is often started manually (`grok` in an existing terminal). GearShift supports three runtime behaviors:

1. **Chat history** — on Enter, `captureInput` in `electron/main.ts` walks the PTY process tree via `detectPtyAgent` → `supportedAgentName` (`electron/supportedAgentName.ts`). Matching commands include bare `grok`, `~/.grok/bin/grok`, and paths containing `grok-build`. The prompt is stored in `gearshift.db` with `agent = "grok"` and appears in the project History sidebar like other agents.
2. **Tab / pane icon** — when Grok is detected, `agentStatus.agentName` is set to `"grok"` and the mono Grok glyph from `src/assets/agents/grok.svg` is shown via `AgentIcon` / `hasAgentIcon`.
3. **No false launch state** — `TerminalPane.agentName` (the persisted “resume this agent” field) only accepts launchable agents (`TerminalAgentName`). Grok is excluded via `isLaunchableAgentName` in `src/components/layout/types.ts`, so a Grok session never writes `agentName: "grok"` into saved project state or auto-runs `grok --resume` on Start/Resume.

Grok does **not** use session-title lookup or Settings → Agents launch flags, but it **is** hook-backed for working / done / blocked semantics.

#### Grok lifecycle hooks

`installGrokHooks` (`electron/agentHooks.ts`) writes a dedicated hook file to `~/.grok/hooks/gearshift.json` (Grok Build discovers every `*.json` in that directory; user-level hooks need no `/hooks-trust`). It maps Grok's Claude-style events onto the shared hook script with agent arg `grok`:

- `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure` → `start` (keeps the busy indicator alive across long multi-tool turns)
- `Stop`, `StopFailure`, `SessionEnd` → `stop`
- `SubagentStart` / `SubagentStop` → subagent pairing, so the renderer holds the "completed" notification until Grok's **parallel subagents** have all finished instead of notifying on the first mid-turn `Stop`
- `Notification` → **deliberately unmapped**. Grok fires `Notification` liberally (even at prompt submit, echoing the user's prompt), not just for permission prompts; mapping it to `needs_attention` spams notifications. Blocked prompts are caught by the strong terminal text-detection cues instead, which can override a working hook. The installer also strips any previously installed Notification entry.

Grok's hook payload differs from Claude's: stdin JSON is **camelCase** (`hookEventName`, `sessionId`, `agentId`) instead of snake_case, and the hook process additionally gets `GROK_HOOK_EVENT` / `GROK_SESSION_ID` env vars. The shared bash hook parses both shapes.

#### Claude-hook double-fire and mislabeling

Grok also discovers and runs Claude Code's hooks from `~/.claude/settings.json`. After the first prompt submit, those fire `gearshift-agent-hook.sh claude start` and would report `agentName: "claude"` even though the running TUI is Grok — duplicating every event and replacing the Grok icon with Claude's.

GearShift prevents that in three places:

- **Hook-script dedupe** — a claude-labeled invocation that carries `GROK_HOOK_EVENT`/`GROK_SESSION_ID` env (or a camelCase `"hookEventName"` stdin payload, the fallback in case the env vars ever go away) is really Grok running Claude's hooks; the script exits silently and lets the dedicated grok-labeled hook report instead.
- **Process tree** — `detectPtyAgent` scans the full PTY subtree and returns `grok` immediately if any descendant matches, even when a child process would otherwise match `claude` first in breadth-first order.
- **Renderer merge** — `mergeRuntimeAgentName` (`src/components/layout/types.ts`) keeps `agentName === "grok"` sticky for as long as the session is `running`, so hook and poller updates cannot downgrade it to `claude`. When the session stops (`running: false`), the identity clears normally.

Relevant tests: `tests/supportedAgentName.test.ts`, `tests/agentStatus.test.ts` (`runtime agent identity`).

## Sidebar Toggle Animation

Both sidebar toggles (left project sidebar, right Git sidebar) use a "snap layout, slide compositor" pattern, deliberately chosen after profiling.

**Before:** the toggle animated a layout property (`margin-left` on the left sidebar, `padding-right` on the right) over 200 ms, so the sidebar and workspace moved together pixel by pixel. Every frame relayouted the entire workspace, capping the slide at roughly half the display refresh rate, and when the slide ended the terminal settle-fit synchronously reflowed the whole scrollback buffer (~5000 lines) — a 50–110 ms main-thread freeze that read as lag. The freeze scales with session size, which is why long-running real sessions felt worse than a fresh dev profile.

**Now:** the workspace reserves space via `paddingLeft`/`paddingRight` that snaps with no transition (one layout pass at toggle time), and only the sidebar panel slides, via a `transform` transition. Transforms animate on the GPU compositor, so the slide stays smooth at full refresh rate even while the terminal reflow runs on the main thread underneath it mid-slide.

**Why:** the terminal fundamentally cannot animate its width smoothly — re-wrapping the scrollback is the expensive step — so the workspace size change has to be a single jump somewhere. Putting the jump at the moment of the click (content snaps, panel glides over/away from it, VS Code-style) hides the heavy work under the animation instead of letting it stutter the animation. The visible trade-off is intentional: on expand the workspace shifts immediately and the sidebar glides in behind it. Alternatives considered and rejected: jump-at-end (reads as a laggy finish), floating overlay sidebar (covers terminal content), no animation at all.

Width drag-resizing keeps its own live path (`gs-sidebar-resizing` on `<body>` suppresses per-frame terminal refits; one settle fit runs after the drag pauses).

Hidden terminals don't refit at all: every project's and tab's panes stay mounted but hidden via `opacity-0`, so they are still laid out and would otherwise each run a scrollback reflow on every workspace width change — with many open terminals those stack into one large main-thread stall. `TerminalView` takes an `isVisible` prop (project active && tab active); hidden panes skip fits, flag them as pending, and replay a single authoritative fit when revealed.

Native window resizes fit live (VS Code-like): the visible terminal tracks the window edge with cheap row-only resizes while the expensive column reflow defers to the settle fit, and the native window background color is kept in sync with the renderer theme so newly exposed areas don't flash a mismatched color mid-resize.

### Keystroke latency

A keystroke crosses the renderer, the main process, the PTY daemon, the agent's own TUI redraw, and then all the way back, so "typing feels laggy" has to be attacked per hop. Two rules shape the whole path.

**Nothing runs before the keystroke is sent.** `TerminalView`'s `onData`, the main process's `term:write` handler, and `DaemonClient.write` all forward the bytes first and do their bookkeeping afterwards. Chat-history capture is deferred with `setImmediate` specifically because on Enter it walks the process tree.

**Batching is only allowed where it cannot delay an echo.** Screens repaint at most once a frame, so flushing *more often* than that buys no earlier pixels — it only adds work. What matters is that the bytes have arrived and been parsed before the frame comes:

- The **daemon** coalesces everything node-pty emits within one event-loop turn into a single frame (`setImmediate`). Zero added delay; far fewer socket frames and `JSON.parse` calls for the main process, which is the same thread that relays keystrokes. Pending output is flushed before an `exit` frame and before a new subscriber attaches (its bytes are already in the replay ring, so leaving them queued would deliver them twice).
- The **daemon-client hop** (main process) batches sustained output on a 16ms timer, but for 250ms after user input it switches to `setImmediate` coalescing — same collapse of a multi-chunk TUI redraw into one IPC message, but with no wall-clock delay.
- The **renderer** batches sustained output on an animation frame, but during that same 250ms input window writes straight through to xterm on arrival. xterm's own write buffer coalesces and its renderer is frame-throttled, so this cannot paint more than once per frame; it only guarantees the echo is already parsed when the frame arrives.

The 250ms window is deliberate: a busy agent can take well over 100ms to redraw its input line, so the earlier 50ms window had expired before the echo it was meant to prioritize arrived. It is also long enough to stay open across continuous typing.

Everything else is about keeping the renderer's single main thread free while an agent works:

- **Agent-signal scanning is off the write path.** The blocked-state detector normalizes up to 8KB of text and `markAgentWorking` re-arms a timer; running that per write made "hand output to xterm" a text-processing job at output rate. It now runs on its own 120ms timer over the text seen since the last scan. Nothing it drives (a spinner, an attention badge) is latency-sensitive.
- **Hidden panes flush at 150ms instead of per frame.** A hidden pane produces no pixels, but its writes still parse escape sequences and mutate the xterm buffer on the thread the visible terminal needs. With several agents in background tabs that was most of the budget. Output still lands in order and in full; the pane is drained and refit on reveal.
- **Watcher-driven refreshes wait for a gap in typing.** An agent writing files fires the project watcher, which invalidates the git-status and file-tree queries and repaints the sidebar — debounced, so it lands the moment the write burst pauses, which is very often the moment the user starts typing. `src/lib/typingActivity.ts` holds those (and only those — explicit user actions refresh immediately) until 250ms after the last keystroke.
- **Agent-status polling shares one cached `ps` snapshot** (~1s TTL) across all panes, instead of spawning one `ps` per pane per poll in the main process — and one batched IPC call, see "Cost of open projects" below.
- **Session→webContents lookup is an id lookup**, not a scan of every window; it runs once per output flush per session.
- **The renderer key/value store** (`src/lib/store.ts`) debounces its persist by 250ms and flushes on hide/unload. Pane titles and agent status change repeatedly while an agent runs and each change calls `saveProjects`, so an immediate write structured-cloned the whole snapshot across IPC many times a second.
- **Renderer background throttling is disabled** so hidden/occluded windows keep draining agent output instead of parsing a backlog on refocus — via `webPreferences.backgroundThrottling: false` *and* the `disable-renderer-backgrounding` / `disable-backgrounding-occluded-windows` / `disable-background-timer-throttling` Chromium switches, since Chromium backgrounds the whole renderer process for an occluded window regardless of the webPreferences flag. Undrained output is capped at 1MB per pane, and regained focus/visibility drains it immediately.

To attribute lag rather than guess at it, set `window.__gsTerminalPerf = true` (or a millisecond threshold) in the renderer devtools console. `src/lib/terminalPerf.ts` then logs each slow keystroke as a three-way split — `roundtrip` (sent → first byte back: IPC, daemon, and the agent's redraw), `queue` (arrived → handed to xterm: our batching, should be ~0 while typing), and `parse` (xterm parse time) — plus any main-thread long task. That distinguishes a slow agent from a slow render path from local jank. It is inert when the flag is unset.

### Cost of open projects

Every open project keeps its whole workspace mounted — hidden via `hiddenLayerClass` (`content-visibility:hidden`, so no layout or paint) and with `isVisible=false` on its terminals, but mounted, because the panes hold live xterm state and agent status the sidebar shows. That makes anything that runs *per mounted pane* scale with how many projects the user has open, which is the one dimension the user grows over a session. Two things did:

- **Polling.** Each pane ran its own 2s agent-status interval, so N panes meant N `invoke`s per tick — N promises, N structured clones, N handler runs in the main process, on the thread that relays keystrokes. `src/lib/agentStatusPoll.ts` is one shared timer that asks for every subscribed session in a single `term:agentStatusMany` call; the main process answers all of them off the one cached `ps` snapshot. Polling cost is now flat in the number of open projects. Newly mounted panes coalesce their first read into one extra round trip rather than one each (a project opens all of its tabs at once).
- **Re-renders.** The `projects` state changes many times a second while an agent runs (pane titles, agent status), and `AppShell` passes ~20 handlers down as inline arrows, so React.memo below it was useless — a title change in one project re-rendered every other project's tabs and terminals. `WorkspaceSplit` routes those handlers through `useStableHandlers` (`src/lib/stableHandlers.ts`: fixed identities forwarding to the latest prop, preserving `undefined` so `!!onSomething` checks still mean "provided"), and `WorkspacePane` is memoized. Since the state updaters preserve the object identity of untouched projects, only the project that actually changed re-renders. `terminalFocusRequest` and `fileReveal` are passed as `null` to non-active projects for the same reason — they only ever address the active one.

Per-project effects follow the same rule: the background git prefetch in `WorkspaceSplit` keys on the project *paths* rather than the `projects` array, so it doesn't re-enter the query client once per open project on every title change.

## Project spaces

Spaces are local project metadata stored with the renderer project snapshot in `gearshift.projects` and `gearshift.spaces`. A fresh install always has the built-in `Personal` space (`space-personal`), and older projects without a `spaceId` hydrate into that space automatically.

The project sidebar filters projects by the active space before applying focus mode, text filtering, pinned grouping, and manual/recent sorting. By default, project rows use independent shadcn Collapsible controls with closed/open folder icons and indented workspace-tab navigation. Multiple projects can remain expanded at once, and selecting or collapsing one does not change the expansion state of the others. Pinned workspace tabs stay above unpinned tabs within their project and persist across reloads. Within each pin group, nested terminal tabs are sorted by the latest captured chat-history message for their PTY sessions, so submitting an agent prompt updates their order while merely selecting a tab does not; tabs without history retain their underlying stable order. This uses a grouped latest-by-session database query plus live append events rather than loading full transcripts. The terminal tab containing the project's most recently submitted agent message shows the same return-arrow marker used for the latest split pane, based on the persisted `lastSubmitAt` timestamp. Each nested tab exposes a right-edge close action on hover. Agent activity indicators appear on the specific nested terminal tab that owns the agent session instead of on the parent project row. In this mode, the workspace's top tab strip is replaced by a compact title bar for the active project while retaining window dragging, pane-drop behavior, and right-side controls. Git changes remain in the Changes list and expand their diffs inline, while file-tree selections create a shared preview tab in the workspace and project sidebar. Leaving the mode disabled preserves the top-strip preview-tab behavior. The active folder row also exposes a quick-add terminal action that uses the same terminal creation flow as the workspace tab bar. Settings → General (`Show project tabs in sidebar`) can disable this hierarchy and restore the compact avatar-based project rows and full top tab strip. Creating a space selects it immediately, even before it has projects. Space settings can rename the active space, with blank and duplicate names rejected. The default space cannot be deleted; deleting another space moves its projects back to the default space before removing it. Moving a project between spaces only changes the project's `spaceId`; terminal panes, tabs, notes, chat history, and project IDs stay unchanged. Workspace panes stay mounted across spaces, and space switches optimistically update the active project while URL navigation catches up. A `Cycle Spaces` keybinding action can switch to the next space in sidebar order, but it is unset by default.

## Space chat

Each space can expose a `Chat` sidebar entry at `/spaces/:spaceId/chat`. The entry is off by default and can be enabled in Settings → General (`Show space chat in sidebar`). The renderer stores the visible chat thread per space in the async state store under `gearshift.spaceChat.<spaceId>`, capped to the most recent messages so reloads restore the conversation without growing the state file indefinitely.

Model calls run in Electron main through `window.spaceChat`; the renderer sends the current space, its projects, and the recent chat messages. Electron main launches `codex app-server` over stdio, checks `account/read`, and uses the user's existing Codex CLI login from `CODEX_HOME`/`~/.codex`. GearShift does not store ChatGPT tokens or OpenAI API keys. Space chat preferences and per-space Codex thread ids are stored in `space-chat-codex.json` under Electron `userData`; `GEARSHIFT_CODEX_MODEL`, `GEARSHIFT_CODEX_BIN`, and `CODEX_HOME` can override the model, Codex binary, and Codex home. Space chat sends Codex turns with low reasoning effort by default.

The first history source is the existing terminal chat-history database. Space chat scopes history to projects in the current space, then injects sanitized, time-windowed snippets into the Codex turn. This lets users ask questions like "what did I do yesterday?" without exposing projects from other spaces.

### Chat history redaction

User prompts are captured in `electron/inputCapture.ts` and saved through `electron/db/appDb.ts`. `appendMessage` redacts likely secrets before writing to `gearshift.db`, and history reads redact again before returning rows so older stored messages are not shown with raw secrets. The redactor masks credential-looking fields (`password`, `api_key`, `token`, etc.), `Authorization` headers, and common key formats with `********`. Stored history bodies are capped at 500 characters, and users can delete individual history items or clear a whole session/project.

### Project notes

Right-sidebar project notes are stored in the same local SQLite database as chat history (`gearshift.db`), in `project_notes` keyed by `project_id`. The renderer reads and saves notes through `window.term.notes`; note edits are debounced for 200 ms before writing to SQLite. The existing loopback-only history server exposes notes to local agents via `GET /notes?projectId=<id>` on the same port as `/history`. The endpoint returns Markdown with the project ID, available project metadata, and the current notes for that project.

### Agent-native session IDs

In addition to GearShift's own per-pane `GEARSHIFT_SESSION_ID` (a UUID we generate and inject at PTY spawn), each lifecycle hook also reports the **agent's own session ID** — e.g. the UUID Claude writes to `~/.claude/projects/<cwd>/<session-id>.jsonl`. This is the id needed to later resume a conversation (`claude --resume <id>`, OpenCode session restore, pi session file, etc.).

The id rides the existing hook wire format as a trailing field:

```
agent|GEARSHIFT_SESSION_ID|event|body|agentSessionId
```

`parseAgentHookPayload` in `electron/agentHooks.ts` parses it; payloads without the field (older 3–4 part messages) still parse with `agentSessionId` left empty. From there it flows `onAgentEvent` → `TerminalView` (a sticky `agentSessionIdRef` merges it onto every emitted status) → `AppShell` (sticky: a missing id never clobbers a saved one) → persisted on the pane as `agentSessionId` in `state.json` (`gearshift.projects`).

Where each agent's id is sourced (all in `electron/agentHooks.ts`):

| Agent        | Source                                                                             | Notes                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Claude**   | bash hook reads stdin JSON, greps `"session_id"`                                   | Reliable. Hook JSON includes `session_id` on every event.                                                                                                                            |
| **Codex**    | same bash hook (`"session_id"` grep)                                               | Best-effort — works if Codex's hook JSON uses the same key.                                                                                                                          |
| **OpenCode** | plugin's `event.properties.sessionID` / `info.id` (the root, non-child session)    | Reliable. Format `ses_…`.                                                                                                                                                            |
| **pi**       | `ctx.sessionManager.getSessionId()` on the handler context (NOT the event payload) | pi events carry no session id; it lives on the `ExtensionContext`. Confirmed via pi's `dist/core/extensions/types.d.ts` → `ExtensionContext.sessionManager: ReadonlySessionManager`. |
| **Grok**     | camelCase `"sessionId"` grep on stdin, `GROK_SESSION_ID` env as fallback           | Reliable. Present on every hook event. Stored for status only — Grok is runtime-only, so it never drives Start/Resume.                                                               |

The shared bash hook reads a **bounded** slice of stdin (`head -c 65536`) so capturing the id on every event (including `start`/`UserPromptSubmit`) never blocks on huge `Stop` payloads. The id is only populated once an agent fires its first `start` hook (i.e. on prompt submit) — merely opening the TUI does not set it.

### Agent session titles

The stored `agentSessionId` is used to resolve a human-readable **session title** that becomes the pane/tab name. `electron/agentSessionTitle.ts` (`getAgentSessionTitle`, exposed over IPC as `term:agentSessionTitle`) locates the agent's session file by id and returns a title in two tiers:

| Agent        | Title source                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Claude**   | last `"type":"ai-title"` line in `~/.claude/projects/<cwd>/<id>.jsonl`                                                        |
| **OpenCode** | `"title"` field in `~/.local/share/opencode/storage/session/<projectID>/<id>.json`                                            |
| **Codex**    | first real user message in `~/.codex/sessions/**/rollout-…-<id>.jsonl` (skips the injected `AGENTS.md`/instructions envelope) |
| **pi**       | first user message in `~/.pi/agent/sessions/<cwd>/<ts>_<id>.jsonl`                                                            |

Lookups find the file by id suffix (`findFileById` matches `<id><ext>`, covering exact names plus codex's `-<id>` and pi's `_<id>` separators), read a bounded slice, and return `null` on any failure. `TerminalView` fetches the title on `start`/`stop` hook events, folds it into the agent status (sticky ref), and it persists per pane as `agentSessionTitle`. The terminal-tab title precedence in `terminalName.ts` is: **tab `customName` → active-pane `customName` → active-pane `agentSessionTitle` → formatted TUI window title (`autoTitle`) → agent display name → fallback**. This keeps the top tab bar and project sidebar in sync when a pane is renamed, while an explicit tab-level name still wins. Terminal tabs can be renamed by double-clicking them in either the top tab bar or the project sidebar.

## GitHub Pull Requests

The Git tab has subtabs for local Changes, repository PRs, and Commits. When the GitHub CLI is installed and available, GearShift lists open pull requests with `gh pr list --state open` and opens selected PRs through `gh pr view --web`.

The Changes subtab also shows pull request status beside the branch picker for the current branch. If an open pull request exists, it opens that PR. If no PR exists and the branch is pushed upstream, GearShift opens GitHub's pull request creation page.

## Workspace previews

File opens from the tree, command palette, or diff context menu reuse one shared workspace preview tab. In the project-sidebar layout, that file preview tab appears below the project alongside terminal tabs instead of opening an embedded viewer in the right sidebar. File and diff preview headers include a close button so the active preview can be dismissed without using a tab list. Closing an active non-terminal tab returns to the project's most recently active terminal when it is still open, then falls back to the neighboring tab. Pinning a file preview preserves it so the next file opens in a new shared preview tab. Diff opens from the Git changes list similarly reuse one shared diff preview tab. Local dev-server links clicked in terminals (`localhost`, `127.0.0.1`, `0.0.0.0`, or `[::1]`) open in one shared in-app dev preview tab, updating that tab when a different local URL is selected.

Agent-terminal text paste never emits a bare return: trailing clipboard line breaks are removed, and internal line breaks use the same non-submitting sequence as Shift+Enter. This prevents pasted text from submitting an existing composer draft; plain shell terminals retain native paste behavior.

## Commit history

The Commits subtab lists recent commits from `git:log`, lazily paged (`useInfiniteQuery`, 50 per page) and loaded on scroll via an `IntersectionObserver` sentinel. Clicking a commit opens a `commit` workspace tab that renders its full diff (`git:show`) through the shared `DiffViewer`.

## PTY daemon & terminating sessions

Terminals are owned by a detached `pty-daemon` (`electron/pty-daemon/server.ts`) that outlives the app window so sessions survive reloads. Each session is a `node-pty` PTY whose master fd is only released when node-pty fires `onExit`, which only happens once the **slave side hits EOF** — i.e. once every process holding the PTY open has died.

**Why sessions must be killed by process group:** node-pty's `pty.kill()` only signals the shell (`this.pid`). But coding agents spawn long-lived children (MCP servers, etc.) in the same process group. Signalling the shell alone leaves those children alive, the slave never EOFs, `onExit` never fires, and **the master fd leaks**. Enough leaked fds exhaust the system PTY table (`kern.tty.ptmx_max`, 511 on macOS) and every app — not just GearShift — then fails to allocate a PTY ("cannot allocate pty device").

`terminateSession` is the single teardown path used by tab-close, the 48h idle sweep, and daemon shutdown. node-pty calls `setsid`, so the shell's pid is the process-group leader; we signal the whole group with `process.kill(-pid, "SIGHUP")`, then `SIGKILL` as a fallback after a short grace if the session hasn't exited. If node-pty still doesn't emit `onExit`, the daemon destroys the internal stream and drops the session record so stale PTY master fds are released. **Never replace this with a bare `pty.kill()`** — that reintroduces the fd leak.

The daemon kills sessions with no user input for 48 hours, but the renderer keeps the pane/tab/split layout. Output, attach, and resize do not reset this timer; typed input is tracked with a 1-second throttled trailing update so rapid keystrokes do not spam idle bookkeeping. The pane flips to pending start and shows a Start/Resume button. If the pane has a saved agent name and `agentSessionId`, clicking the button starts that agent with its resume flag (`claude --resume`, `codex resume`, `opencode --session`, or `pi --session`).

To diagnose a suspected leak: `lsof | grep -c ptmx` (count held PTY master fds) vs. the number of live shells. A large gap means fds are leaking; restarting the daemon frees them immediately.
