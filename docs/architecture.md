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

Terminal panes detect supported coding agents by asking the Electron main process to inspect the PTY shell's child process tree. GearShift passes each terminal a `GEARSHIFT_SESSION_ID` and `GEARSHIFT_AGENT_SOCKET` so supported lifecycle hooks can report status back over a local Unix socket. Agent-specific hooks and plugins are normalized into GearShift lifecycle events: `start`, `stop`, `needs_attention`, and (Claude only) `subagent_start`/`subagent_stop`. Claude's `Stop` hook fires whenever the main agent finishes a turn, even while background subagents are still running, so GearShift tracks subagent lifecycles and holds the "completed" notification until the last pending background subagent has stopped.

Display code derives a single semantic state from runtime flags: `blocked`, `working`, `done`, `idle`, or `unknown`. The priority is `blocked > working > done > idle > unknown`, so a pane or project that needs input wins over normal progress. Hooks remain authoritative for normal `working`/`done` lifecycle while active or recent, but strong blocked-prompt cues can override a working hook when an agent asks inline questions without firing a dedicated attention hook. If hooks are missing or stale, strong terminal title/output cues provide a fallback for Codex, Claude, and OpenCode: title spinners mean `working`, Codex "Action Required", permission prompts, and OpenCode question menus mean `blocked`, and a return to a known idle title after fallback work marks the turn `done`.

The renderer combines lifecycle hooks, process detection, terminal title changes, and terminal output cues to show project-level activity. Background completions can surface as in-app or desktop notifications, and the count of unviewed completed agents is mirrored as a red badge on the dock icon (cleared as the flagged panes are viewed). For pi, GearShift also wraps interactive `ctx.ui` prompts so post-turn menus like plan approval report `needs_attention` instead of a completed state.

## Sidebar Toggle Animation

Both sidebar toggles (left project sidebar, right Git sidebar) use a "snap layout, slide compositor" pattern, deliberately chosen after profiling.

**Before:** the toggle animated a layout property (`margin-left` on the left sidebar, `padding-right` on the right) over 200 ms, so the sidebar and workspace moved together pixel by pixel. Every frame relayouted the entire workspace, capping the slide at roughly half the display refresh rate, and when the slide ended the terminal settle-fit synchronously reflowed the whole scrollback buffer (~5000 lines) — a 50–110 ms main-thread freeze that read as lag. The freeze scales with session size, which is why long-running real sessions felt worse than a fresh dev profile.

**Now:** the workspace reserves space via `paddingLeft`/`paddingRight` that snaps with no transition (one layout pass at toggle time), and only the sidebar panel slides, via a `transform` transition. Transforms animate on the GPU compositor, so the slide stays smooth at full refresh rate even while the terminal reflow runs on the main thread underneath it mid-slide.

**Why:** the terminal fundamentally cannot animate its width smoothly — re-wrapping the scrollback is the expensive step — so the workspace size change has to be a single jump somewhere. Putting the jump at the moment of the click (content snaps, panel glides over/away from it, VS Code-style) hides the heavy work under the animation instead of letting it stutter the animation. The visible trade-off is intentional: on expand the workspace shifts immediately and the sidebar glides in behind it. Alternatives considered and rejected: jump-at-end (reads as a laggy finish), floating overlay sidebar (covers terminal content), no animation at all.

Width drag-resizing keeps its own live path (`gs-sidebar-resizing` on `<body>` suppresses per-frame terminal refits; one settle fit runs after the drag pauses).

Hidden terminals don't refit at all: every project's and tab's panes stay mounted but hidden via `opacity-0`, so they are still laid out and would otherwise each run a scrollback reflow on every workspace width change — with many open terminals those stack into one large main-thread stall. `TerminalView` takes an `isVisible` prop (project active && tab active); hidden panes skip fits, flag them as pending, and replay a single authoritative fit when revealed.

Native window resizes fit live (VS Code-like): the visible terminal tracks the window edge with cheap row-only resizes while the expensive column reflow defers to the settle fit, and the native window background color is kept in sync with the renderer theme so newly exposed areas don't flash a mismatched color mid-resize.

## Project spaces

Spaces are local project metadata stored with the renderer project snapshot in `gearshift.projects` and `gearshift.spaces`. A fresh install always has the built-in `Personal` space (`space-personal`), and older projects without a `spaceId` hydrate into that space automatically.

The project sidebar filters projects by the active space before applying focus mode, text filtering, pinned grouping, and manual/recent sorting. Creating a space selects it immediately, even before it has projects. Space settings can rename the active space, with blank and duplicate names rejected. The default space cannot be deleted; deleting another space moves its projects back to the default space before removing it. Moving a project between spaces only changes the project's `spaceId`; terminal panes, tabs, notes, chat history, and project IDs stay unchanged. Workspace panes stay mounted across spaces, and space switches optimistically update the active project while URL navigation catches up. A `Cycle Spaces` keybinding action can switch to the next space in sidebar order, but it is unset by default.

## Space chat

Each space has a `Chat` sidebar entry at `/spaces/:spaceId/chat`. The renderer stores the visible chat thread per space in the async state store under `gearshift.spaceChat.<spaceId>`, capped to the most recent messages so reloads restore the conversation without growing the state file indefinitely.

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

The shared bash hook reads a **bounded** slice of stdin (`head -c 65536`) so capturing the id on every event (including `start`/`UserPromptSubmit`) never blocks on huge `Stop` payloads. The id is only populated once an agent fires its first `start` hook (i.e. on prompt submit) — merely opening the TUI does not set it.

### Agent session titles

The stored `agentSessionId` is used to resolve a human-readable **session title** that becomes the pane/tab name. `electron/agentSessionTitle.ts` (`getAgentSessionTitle`, exposed over IPC as `term:agentSessionTitle`) locates the agent's session file by id and returns a title in two tiers:

| Agent        | Title source                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Claude**   | last `"type":"ai-title"` line in `~/.claude/projects/<cwd>/<id>.jsonl`                                                        |
| **OpenCode** | `"title"` field in `~/.local/share/opencode/storage/session/<projectID>/<id>.json`                                            |
| **Codex**    | first real user message in `~/.codex/sessions/**/rollout-…-<id>.jsonl` (skips the injected `AGENTS.md`/instructions envelope) |
| **pi**       | first user message in `~/.pi/agent/sessions/<cwd>/<ts>_<id>.jsonl`                                                            |

Lookups find the file by id suffix (`findFileById` matches `<id><ext>`, covering exact names plus codex's `-<id>` and pi's `_<id>` separators), read a bounded slice, and return `null` on any failure. `TerminalView` fetches the title on `start`/`stop` hook events, folds it into the agent status (sticky ref), and it persists per pane as `agentSessionTitle`. The title precedence in `terminalName.ts` is: **`customName` (explicit user name) → `agentSessionTitle` → formatted TUI window title (`autoTitle`) → agent display name → fallback**. So a user-set name always wins; otherwise the agent's own title replaces the generic TUI title (e.g. "✳ Claude Code").

## GitHub Pull Requests

The Git tab has subtabs for local Changes, repository PRs, and Commits. When the GitHub CLI is installed and available, GearShift lists open pull requests with `gh pr list --state open` and opens selected PRs through `gh pr view --web`.

The Changes subtab also shows pull request status beside the branch picker for the current branch. If an open pull request exists, it opens that PR. If no PR exists and the branch is pushed upstream, GearShift opens GitHub's pull request creation page.

## Workspace previews

File opens from the tree, command palette, or diff context menu reuse one shared file preview tab. Diff opens from the Git changes list reuse one shared diff preview tab. Local dev-server links clicked in terminals (`localhost`, `127.0.0.1`, `0.0.0.0`, or `[::1]`) open in one shared in-app dev preview tab, updating that tab when a different local URL is selected.

## Commit history

The Commits subtab lists recent commits from `git:log`, lazily paged (`useInfiniteQuery`, 50 per page) and loaded on scroll via an `IntersectionObserver` sentinel. Clicking a commit opens a `commit` workspace tab that renders its full diff (`git:show`) through the shared `DiffViewer`.

## PTY daemon & terminating sessions

Terminals are owned by a detached `pty-daemon` (`electron/pty-daemon/server.ts`) that outlives the app window so sessions survive reloads. Each session is a `node-pty` PTY whose master fd is only released when node-pty fires `onExit`, which only happens once the **slave side hits EOF** — i.e. once every process holding the PTY open has died.

**Why sessions must be killed by process group:** node-pty's `pty.kill()` only signals the shell (`this.pid`). But coding agents spawn long-lived children (MCP servers, etc.) in the same process group. Signalling the shell alone leaves those children alive, the slave never EOFs, `onExit` never fires, and **the master fd leaks**. Enough leaked fds exhaust the system PTY table (`kern.tty.ptmx_max`, 511 on macOS) and every app — not just GearShift — then fails to allocate a PTY ("cannot allocate pty device").

`terminateSession` is the single teardown path used by tab-close, the 24h idle sweep, and daemon shutdown. node-pty calls `setsid`, so the shell's pid is the process-group leader; we signal the whole group with `process.kill(-pid, "SIGHUP")`, then `SIGKILL` as a fallback after a short grace if the session hasn't exited. If node-pty still doesn't emit `onExit`, the daemon destroys the internal stream and drops the session record so stale PTY master fds are released. **Never replace this with a bare `pty.kill()`** — that reintroduces the fd leak.

The daemon kills sessions with no user input for 24 hours, but the renderer keeps the pane/tab/split layout. Output, attach, and resize do not reset this timer; typed input is tracked with a 1-second throttled trailing update so rapid keystrokes do not spam idle bookkeeping. The pane flips to pending start and shows a Start/Resume button. If the pane has a saved agent name and `agentSessionId`, clicking the button starts that agent with its resume flag (`claude --resume`, `codex resume`, `opencode --session`, or `pi --session`).

To diagnose a suspected leak: `lsof | grep -c ptmx` (count held PTY master fds) vs. the number of live shells. A large gap means fds are leaking; restarting the daemon frees them immediately.
