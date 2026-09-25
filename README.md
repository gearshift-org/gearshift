# GearShift

GearShift is an Electron workspace app for developers who work across multiple local projects and terminal-based coding agents.

It brings project tabs, terminal panes, file previews, git changes, pull request shortcuts, and agent activity indicators into one desktop app.

## Status

GearShift is early-stage software. Expect rough edges, active changes, and macOS-first behavior while the project settles.

## Features

- Multi-project workspace with project tabs, optional nested sidebar tabs and sidebar file/change previews, split panes, and custom project avatars.
- File tree with drag-and-drop moves, singleton file/diff/dev preview tabs, Markdown/PDF/media rendering, and syntax-highlighted diffs.
- Git status, file changes, branch actions, open pull request lists, and pull request shortcuts.
- Agent activity detection for supported CLI coding agents (Claude, Codex, OpenCode, pi).
- Claude Chat tabs with a native chat input, streamed replies, and tool approvals, powered by the system Claude Code binary.
- Grok Build CLI support when started manually: chat-history capture and tab/pane icon (not a tab-bar launch target).
- Configurable default launch options for supported coding-agent terminals.
- Space-scoped chat powered by Codex that can answer questions from captured project history.
- Desktop notifications and optional in-app notification cards when background agent work finishes or needs input.
- Theme settings with system/light/dark modes, selectable color themes, appearance controls, and searchable keybinding settings.

## Tech Stack

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- TanStack Router
- TanStack Query
- CodeMirror
- xterm.js
- Drizzle ORM with libSQL

## Requirements

- macOS is the primary supported platform right now.
- [Bun](https://bun.sh/) for dependency installation and scripts.
- Git for project status and diffs.
- Optional: [GitHub CLI](https://cli.github.com/) for pull request actions.
- Optional: `direnv` for project-specific GitHub CLI environments.
- Claude Code installed and authenticated (`claude auth login`) for Claude Chat tabs.

## Getting Started

Install dependencies:

```bash
bun install
```

Start the app in development mode:

```bash
bun run dev
```

Run type checking:

```bash
bun run typecheck
```

Run linting:

```bash
bun run lint
```

Create a production build:

```bash
bun run build
```

Create a local macOS app build without signing or notarization:

```bash
bun run dist
```

Create a local macOS DMG without signing or notarization:

```bash
bun run dist:dmg
```

## Project Structure

```text
electron/                 Electron main process, preload bridge, PTY daemon, and local data access
src/                      React renderer app
src/components/layout/    Main workspace, panes, terminal, files, git, and shell UI
src/components/ui/        Shared UI primitives
src/routes/settings/      Settings screens
src/lib/                  Renderer utilities, stores, project state, and keybindings
```

## Development Notes

- The app uses `vite-plugin-electron` so `bun run dev` starts the renderer and Electron together.
- Native modules are rebuilt after install through `electron-builder install-app-deps`.
- The app stores development data under `gearshift-dev` and production data under `com.gearshift`.
- GearShift auto-installs/updates a `gearshift` CLI on macOS in a writable bin directory. Use `gearshift .` or `gearshift /path/to/project` to open a folder in GearShift.
- The GitHub integration uses the local `gh` CLI. GearShift does not manage GitHub API tokens.
- If `direnv` is installed, GearShift evaluates the opened project's `.envrc` before running `gh`.

## Claude Chat

Open a project, then choose **Claude Chat** from the new-tab menu. In the nested project sidebar layout, use the project's **+** menu or context menu. Chats split like terminals: with a chat focused, Cmd+D or Cmd+Shift+D opens another chat beside or below it in the same tab, and the panes can be resized, rearranged, maximized, and closed the same way. Type a message and press Enter to send it; Shift+Enter adds a line break. Paste images (PNG, JPEG, GIF, WebP) into the input, or drop them anywhere on the chat, to send them with your message; large images are scaled down to 1568px on the long side first. Press ↑ at the start of the input to bring back your earlier messages in that chat for editing and resending, and ↓ to go forward again. After a reply, Claude Code's suggested next prompt appears in the empty input; press Tab or → to use it, then edit or send it. You can keep sending while Claude works: each message steers the running turn, as typing mid-turn does in the Claude Code CLI, and one sent just as a turn ends is queued and sent next. A new, empty chat can instead continue one of the project's Claude Code sessions: choose **Resume a previous session**, search, and pick one to load its conversation and carry on. Type `@` to pick a project file (fuzzy search over git-tracked and untracked, non-ignored files); it's inserted as `@path`, which Claude Code expands into the file. You can also drag files or folders from the Files sidebar (or a diff), or non-image files from Finder, onto the chat to insert them the same way at the cursor: relative to the project when they're inside it, absolute otherwise, and quoted if the path has spaces. Type `/` to pick from Claude Code's slash commands and skills (built-in, user, and project), filtered as you type; use the arrow keys and Enter or Tab to pick one. The command appears as a bold chip at the start of the input; type any arguments after it, or press Backspace at the start to edit the command as text. GearShift runs your existing `claude` binary in the project directory through the Claude Agent SDK and shows replies and tool requests in the chat. Approve or deny tool requests in the chat; each waiting request gets its own card, file edits show their diff, and **Allow for this session** stops Claude Code asking again for the same kind of call until the chat's session ends (nothing is written to your settings). Replies show Claude's text and tool calls in the order they happened, and edit tool lines show `+added −removed` counts and expand into a diff. When Claude asks a multiple-choice question, pick an option (or several, when allowed), or choose **Other** to type your own answer, then submit or skip. Press Stop or Esc twice to stop the current turn; the chat shows "Stopping…" at once and marks the reply as stopped. While Claude works, each tool call appears as a readable line (click it to see the exact command or file), with a live status underneath showing elapsed time, output tokens, and whether Claude is thinking, writing, running tools, or waiting for your approval.

The model menu is loaded from your installed Claude Code CLI through the Claude Agent SDK. Each entry shows the exact model version and what it's best for, and the button shows the version you've picked, e.g. **Opus 5.5 · 1M**. Choose a model and one of its supported effort levels above the input for the next message. Leaving either at **Default** uses your Claude Code configuration. Your selections are saved with the chat, and new chats start with the model, effort, and mode you picked most recently. The model list is cached, so the menus are ready as soon as a chat opens; it refreshes in the background (at most every 10 minutes) and updates if your installed models change. If model lookup fails with nothing cached, chat remains available with Claude's defaults.

The mode menu controls tool permissions: **Auto** (the default) lets Claude's classifier approve or deny tool use, **Manual** asks before every change, **Accept edits** auto-approves file edits, **Plan** has Claude propose a plan for you to approve before it makes changes, and **Full access** runs commands and edits without asking. Full access must be picked from the menu each time: it isn't in the Shift+Tab cycle, new chats don't inherit it, and choosing it mid-reply applies from your next message. Press Shift+Tab in the input to cycle modes, or 1–5 while the menu is open. Changing the mode during a running turn applies immediately. Approving a plan switches the chat back to Auto.

The tab title follows the Claude session's title, the same one Claude Code shows in `/resume`: a `/rename` title if set, otherwise Claude's generated title or your first prompt. It updates as soon as Claude Code has one, usually a few seconds into the first reply. Chat messages and Claude's session ID are saved with the workspace. Reopening the app restores the chat and resumes the same Claude conversation on the next message. Closing a chat pane, or its tab, removes its saved messages. Terminal-based Claude tabs remain available separately.

## Documentation

- [Architecture](docs/architecture.md)

## Contributing

Contributions are welcome.

Before opening a pull request:

1. Run `bun run typecheck`.
2. Run `bun run lint`.
3. Keep changes focused and include screenshots for UI changes when useful.
4. Update this README or related docs when behavior changes.

## License

No license has been added yet. Add a license before publishing this repository as open source.
