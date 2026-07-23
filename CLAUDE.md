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

## Editor Tabs

Open files render as tabs in a strip above the editor. The strip supports drag-to-reorder and horizontal scrolling (VS Code-style).

| File | Role |
|------|------|
| `client/src/components/editor/EditorTabs.tsx` | Renders the tab strip. Each tab is `draggable`; `onDragStart` records the source index in `dragIndexRef`, `onDragOver` sets `dragOverIndex` (draws an accent left border as a drop hint), and `onDrop` calls `onTabReorder(fromIndex, toIndex)`. `handleWheel` converts a predominantly-vertical mouse-wheel gesture into horizontal `scrollLeft` when the strip overflows (`overflowX: 'auto'`). Active tabs get an accent top border; dirty files show a dot that swaps to a close button on hover. |
| `client/src/components/layout/EditorArea.tsx` | Accepts the optional `onTabReorder?: (fromIndex, toIndex) => void` prop and threads it (along with `openFiles`, `activeFilePath`, `onTabClick`, `onTabClose`) into `EditorTabs`. |
| `client/src/hooks/useOpenFiles.ts` | `reorderFiles(fromIndex, toIndex)` is the state updater: it bounds-checks the indices then splices the moved entry into its new position in `openFiles`. Exposed from the hook and wired to `EditorArea`'s `onTabReorder` in `WorkbenchLayout`. |

## Editor Menu — Tab Management

The **Editor** menu in the menu bar provides three tab-management actions:

| Action | Description | Implementation |
|--------|-------------|-----------------|
| **Close All Tabs** | Closes all open tabs with a confirmation dialog | `MenuBar.tsx` shows a dialog asking "Are you sure you want to close all N tabs?" |
| **Close Unedited Files** | Closes all tabs that have no unsaved changes (no dirty indicator dot) | `MenuBar.tsx` calls `onCloseUneditedTabs()`, which filters `openFiles` in `useOpenFiles.ts` to retain only files where `isDirty === true` |
| **Sort Tabs by File Structure** | Arranges tabs in the order they appear in the file tree | `MenuBar.tsx` calls `onSortTabsByFileStructure()`, which sorts `openFiles` by workspace-relative path |

These actions are wired in `MenuBar.tsx` via callbacks from `WorkbenchLayout.tsx`:
- `MenuBarProps.onCloseAllTabs` → closes all files
- `MenuBarProps.onCloseUneditedTabs` → closes only unedited files  
- `MenuBarProps.onSortTabsByFileStructure` → reorders tabs by path

The "Close All Tabs" action requires confirmation. "Close Unedited Files" runs immediately with no dialog since it only affects clean files. All three buttons are disabled when no tabs are open.

## AI Summary

The editor pane has a three-way view toggle: **source / preview / summary**.

| File | Role |
|------|------|
| `client/src/components/layout/EditorArea.tsx` | Owns `editorView` state (`'source' \| 'preview' \| 'summary'`). Renders the `🤖 Summary` button for any non-image file when a workspace is open. Streams `text_delta` SSE events from the server and renders partial Markdown progressively. Provides a `↺ Regenerate` button to clear the in-session cache and re-run. Accepts `summaryRequestPath` prop to open in summary view when triggered externally (both files and directories). |
| `server/src/routes/aiSummary.ts` | `GET /api/ai-summary?path=` and `GET /api/ai-directory-summary?path=` check the disk cache. `POST /api/ai-summary/generate` and `POST /api/ai-directory-summary/generate` stream LLM-generated summaries, then write to cache. |

**File cache path:** `~/.iodine/<workspace-md5>/<relpath-md5>/<file-content-md5>_ai_summary.md`
**Directory cache path:** `~/.iodine/<workspace-md5>/<relpath-md5>/<dir-contents-md5>_ai_dir_summary.md`
The content hash means the cache auto-invalidates when the file/directory structure changes.

**Directory summary** is accessible via the `+` hover menu on any folder in the file tree ("View/Generate Summary"). Directories open as synthetic tabs with `isDirectory: true`; `WorkbenchLayout` calls `handleDirSummary` which opens the tab and sets `summaryRequestPath`, triggering `EditorArea` to auto-switch to summary view and start generation.

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

## Coding Assistant Context Chips ("Add to Context")

Files and folders can be pinned to the Coding Assistant via the `+` hover menu in the file tree. Pinned items appear as chips above the chat input and inject a **Relevant paths hint** block into the API message when the user sends, guiding the LLM to those paths first.

| File | Role |
|------|------|
| `client/src/components/sidebar/FileTreeNode.tsx` | "Add to Context" option in the `+` dropdown for every file and directory. Calls `onAddToContext(node)`. |
| `client/src/components/sidebar/FileExplorer.tsx` | Threads `onAddToContext` down to `FileTreeNode`. |
| `client/src/components/layout/Sidebar.tsx` | Threads `onAddToContext` down to `FileExplorer`. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Owns `contextNodes: FileNode[]` state. `handleAddToContext` de-dupes and appends; `handleRemoveContextNode` removes one; `handleClearContextNodes` clears all (called after send). Passes all three to `RightPanel`. |
| `client/src/components/layout/RightPanel.tsx` | Threads `contextNodes`, `onRemoveContextNode`, `onClearContextNodes` to `CodingAssistant`. |
| `client/src/components/right/CodingAssistant.tsx` | Renders chips above the textarea. In `handleSend` converts nodes to workspace-relative paths, clears chips, and passes paths to `sendMessage`. |
| `client/src/hooks/useCodingAssistant.ts` | `sendMessage` accepts `contextPaths?: string[]`. If present, prepends a `**Relevant paths hint**` block to the API content (before User Visual Context). |

## Right Panel & Provider/Model Display

The right panel contains three tabs: **Coding Assistant**, **Build**, and **System View**. Each tab can use a different LLM provider and model. The **Provider/Model callout** (showing current provider name and model label) appears above all three tabs *except* the Coding Assistant tab, where the provider and model are set directly within the chat UI and displaying them would be redundant.

| File | Role |
|------|------|
| `client/src/components/layout/RightPanel.tsx` | Conditionally renders the Provider/Model info box only when `activeTab !== 'assistant'`. The callout is hidden for the Coding Assistant tab to avoid redundancy. |

## Project Metadata (Download / Import / Clear)

The **Project** menu (visible only when a workspace is open) manages the workspace's `~/.iodine/<workspace-md5>/` cache directory, which holds AI summaries and build config.

| Action | Client | Server |
|--------|--------|--------|
| Download | `downloadProjectMetadata()` in `client/src/api/files.ts` fetches the endpoint, receives a blob, and triggers a browser download via a temporary object URL | `GET /api/project/metadata/download` — spawns `zip -r - .` from the cache dir and pipes stdout to the response as `application/zip` |
| Import | `importProjectMetadata(file)` POSTs the raw `File` object as `application/octet-stream` | `POST /api/project/metadata/import` — uses `express.raw()` to receive the zip body, writes it to a temp file, runs `unzip -o`, then cleans up |
| Clear | `clearProjectMetadata()` sends `DELETE` | `DELETE /api/project/metadata` — calls `fs.rm(cacheDir, { recursive: true, force: true })` |

The server route is in `server/src/routes/project.ts`, registered at `/api/project` in `server/src/app.ts`. The Project menu is in `client/src/components/layout/MenuBar.tsx`; "Clear Metadata" shows a custom confirm dialog before deleting.

## Implementation Notes

For the full project architecture, APIs, and feature details, inspect the relevant source files and `README.md`. Keep this document concise to preserve context-window space.
