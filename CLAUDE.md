# Iodine — Few Drops of IDE Essentials — Developer Notes

## Light / Dark Mode

Theme support is client-side and uses shared CSS variables so components do not need separate light and dark implementations.

| File | Role |
|------|------|
| `client/src/hooks/useTheme.ts` | Owns the `light` / `dark` state, reads and writes the `iodine-theme` local-storage preference, falls back to `prefers-color-scheme`, and sets `data-theme` plus `color-scheme` on `<html>`. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Mounts `useTheme()` and passes the current theme and toggle callback to the menu bar. |
| `client/src/components/layout/MenuBar.tsx` | Renders the sun/moon toggle and calls `onToggleTheme`. |
| `client/src/index.css` | Defines the default dark tokens in `:root` and light overrides in `:root[data-theme='light']`. The activity bar, sidebars, editor, tabs, assistant, terminal tray, inputs, previews, canvas, borders, text, icons, and scrollbars consume these variables. |
| `client/src/components/editor/MonacoEditor.tsx` | Selects Monaco's `light` or `vs-dark` theme from `document.documentElement.dataset.theme`. |
| `client/src/components/right/SystemView.tsx` | Applies the matching Monaco theme to the System View JSON editor. |
| `client/src/components/bottom/TerminalSession.tsx` | Builds the xterm theme from CSS variables and observes the root `data-theme` attribute so existing sessions update without reconnecting. |
| `client/src/components/bottom/TerminalPanel.tsx` | Styles the terminal tab strip, active tab, labels, and controls with shared theme variables. |
| `client/src/components/right/CodingAssistant.tsx` | Uses theme variables for assistant cards, command text, and live terminal-command output. |

When adding or changing UI, use the existing `--color-*` variables rather than hard-coded dark colors. Add a semantic token to both `:root` and `:root[data-theme='light']` when no suitable variable exists. Canvas-rendered or third-party widgets such as xterm and Monaco do not automatically inherit CSS colors; explicitly update their theme when `data-theme` changes.

## AI Summary

The editor pane has a three-way view toggle: **source / preview / summary**.

| File | Role |
|------|------|
| `client/src/components/layout/EditorArea.tsx` | Owns `editorView` state (`'source' \| 'preview' \| 'summary'`). Renders the `🤖 Summary` button for any non-image file when a workspace is open. Streams `text_delta` SSE events from the server and renders partial Markdown progressively. Provides a `↺ Regenerate` button to clear the in-session cache and re-run. |
| `server/src/routes/aiSummary.ts` | `GET /api/ai-summary?path=` checks the disk cache and returns cached content. `POST /api/ai-summary/generate` streams an LLM-generated tutorial-style summary, then writes it to the cache. |

**Cache path:** `~/.iodine/<workspace-md5>/<relpath-md5>/<file-content-md5>_ai_summary.md`
The file-content hash means the cache auto-invalidates when the file changes.

**Provider/model state** is owned by `WorkbenchLayout` and passed down to `RightPanel`, `CodingAssistant`, `SystemView`, and `EditorArea` so all features share the same selection.

## Build Assistant

The **Build** tab in the right panel provides three sections — **Test**, **Build**, and **Build & Run** — each with an editable command field, an AI **Generate** button, and an **Execute** button. A **Save** button at the bottom persists all three commands to disk and reloads them automatically on the next workspace open.

| File | Role |
|------|------|
| `client/src/components/right/BuildAssistant.tsx` | UI component. Loads saved config from `GET /api/build-config` on workspace change. Streams AI-generated commands via `POST /api/build-config/generate`. Execute calls `runCommandInTerminal(cmd)` which opens a new terminal tab pre-loaded with the command. |
| `server/src/routes/buildConfig.ts` | `GET /api/build-config` reads `~/.iodine/{md5}/build-config.json`. `PUT /api/build-config` writes it. `POST /api/build-config/generate` probes the workspace for project type (package.json scripts, Makefile targets, Cargo.toml, etc.) and streams a single shell command from the selected LLM. |
| `client/src/components/bottom/TerminalPanel.tsx` | Converted to `forwardRef`. Exposes `TerminalPanelHandle.runCommand(cmd)` which creates a new tab with `ws://localhost:3001/terminal?cwd=…&cmd=…` — the server spawns the shell with `-c cmd` automatically. The tab label shows the command's first token. |
| `client/src/components/bottom/BottomTray.tsx` | Converted to `forwardRef`. Exposes `BottomTrayHandle.runCommand(cmd)` which activates the Terminal tab then delegates to `TerminalPanel`. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Holds `bottomTrayRef` and creates `runCommandInTerminal` callback, threading it to `RightPanel`. |
| `client/src/components/layout/RightPanel.tsx` | Adds "Build" tab between Coding Assistant and System View. Passes `runCommandInTerminal` to `BuildAssistant`. |

**Persistence path:** `~/.iodine/{MD5(workspacePath)}/build-config.json`

## User Visual Context in Coding Assistant

When the user sends a message, the coding assistant automatically appends the currently visible lines (or selected text) from the Monaco editor to the API request as a **User Visual Context** block. The UI displays only the user's typed message; the context is invisible to the user but available to the LLM.

| File | Role |
|------|------|
| `client/src/components/editor/MonacoEditor.tsx` | Accepts `onEditorMount` prop; calls it with the Monaco editor instance once mounted. |
| `client/src/components/layout/EditorArea.tsx` | Stores the editor instance in `monacoEditorRef`. Exposes `getVisibleContext()` on `EditorAreaHandle`, which reads the selection (if non-empty) or the first visible range and returns line-numbered text. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Creates `getEditorContext` callback (`editorAreaRef.current?.getVisibleContext()`) and passes it to `RightPanel`. |
| `client/src/components/layout/RightPanel.tsx` | Threads `getEditorContext` through to `CodingAssistant`. |
| `client/src/components/right/CodingAssistant.tsx` | Calls `getEditorContext()` in `handleSend` and passes the result to `sendMessage`. |
| `client/src/hooks/useCodingAssistant.ts` | `sendMessage` accepts `editorContext?: string \| null`. If present, appends it as a fenced code block under `**User Visual Context**` in the API history entry only (not in the UI message). |

## Implementation Notes

For the full project architecture, APIs, and feature details, inspect the relevant source files and `README.md`. Keep this document concise to preserve context-window space.
