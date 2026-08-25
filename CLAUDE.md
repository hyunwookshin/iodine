# Iodine — IDE for Open-source Development — Developer Notes

This document is organized from project-wide conventions and architecture to feature-specific implementation details. For the full project architecture, APIs, and feature details, inspect the relevant source files and `README.md`.

## Project Conventions

### Naming Convention — Marketing Names vs. Internal Identifiers

Several features have branded display names shown in the UI. These names must **never** be used for internal technical objects (variables, functions, props, types, CSS classes, API routes, or file names). **Always** use the plain descriptive technical name internally.

| UI display name | Internal technical name to use |
|-----------------|-------------------------------|
| **Iogram** | `systemView` / `system` / `SystemView` |
| **IOPEDIA** | `outline` / `OutlinePanel` |
| **Coding Assistant** | `codingAssistant` / `CodingAssistant` |

Examples of correct usage:
- Tab id: `'system'` ✓ — not `'iogram'`
- Method: `openSystemView()` ✓ — not `openIogram()`
- Component: `<SystemView>` ✓ — not `<Iogram>`
- Prop: `onSummaryOpen` ✓ — describes the event, not the brand

The display label string (e.g. `'Iogram'`) is the only place the marketing name appears.

## Client Architecture

### Shared UI Behavior

#### Light / Dark Mode

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

When adding or changing UI, use the **existing `--color-*` variables** rather than hard-coded dark colors. Add a semantic token to **both** `:root` and `:root[data-theme='light']` when no suitable variable exists. Canvas-rendered or third-party widgets such as xterm and Monaco do not automatically inherit CSS colors; explicitly update their theme when `data-theme` changes.

### Editor Experience

#### Editor Tabs

Open files render as tabs in a strip above the editor. The strip supports drag-to-reorder and horizontal scrolling (VS Code-style).

| File | Role |
|------|------|
| `client/src/components/editor/EditorTabs.tsx` | Renders the tab strip. Each tab is `draggable`; `onDragStart` records the source index in `dragIndexRef`, `onDragOver` sets `dragOverIndex` (draws an accent left border as a drop hint), and `onDrop` calls `onTabReorder(fromIndex, toIndex)`. `handleWheel` converts a predominantly-vertical mouse-wheel gesture into horizontal `scrollLeft` when the strip overflows (`overflowX: 'auto'`). Active tabs get an accent top border; dirty files show a dot that swaps to a close button on hover. |
| `client/src/components/layout/EditorArea.tsx` | Accepts the optional `onTabReorder?: (fromIndex, toIndex) => void` prop and threads it (along with `openFiles`, `activeFilePath`, `onTabClick`, `onTabClose`) into `EditorTabs`. |
| `client/src/hooks/useOpenFiles.ts` | `reorderFiles(fromIndex, toIndex)` is the state updater: it bounds-checks the indices then splices the moved entry into its new position in `openFiles`. Exposed from the hook and wired to `EditorArea`'s `onTabReorder` in `WorkbenchLayout`. |

#### Editor Menu — Tab Management

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

The "Close All Tabs" action **requires confirmation**. "Close Unedited Files" runs immediately with no dialog since it only affects clean files. All three buttons are disabled when no tabs are open.

#### Image & PDF Viewers

Binary files (images and PDFs) are displayed in dedicated viewers instead of being loaded into the text editor.

| File | Role |
|------|------|
| `client/src/components/editor/ImageViewer.tsx` | Renders JPEG, PNG, GIF, WebP, SVG and other image formats with zoom controls (`In`, `Out`, `Reset`). Displays the filename in a toolbar. Shows an error message if the image fails to load. |
| `client/src/components/editor/PdfViewer.tsx` | Renders PDF files using an iframe that connects to `GET /api/files/pdf?path=`. Displays the filename in a toolbar. Shows an error message if the PDF fails to load. |
| `client/src/hooks/useOpenFiles.ts` | `isPdfFile(path)` helper detects `.pdf` extensions. When opening a PDF, it's marked with `isPdf: true` and no content is fetched (similar to images). `refreshFile()` skips PDFs since they don't need content updates. |
| `client/src/types/index.ts` | `OpenFile` interface includes optional `isPdf?: boolean` property to indicate PDF files. |
| `client/src/components/layout/EditorArea.tsx` | Checks `activeFile.isImage` or `activeFile.isPdf` and renders the appropriate viewer component. PDFs are excluded from AI summary and preview features (only text files support these). |
| `server/src/routes/files.ts` | `GET /api/files/image?path=` and `GET /api/files/pdf?path=` retrieve files from the workspace using a relative path query parameter. Both endpoints set appropriate MIME types and handle errors. |

**Key behavior:** Images and PDFs do not appear in the editor pane as source code; they render in purpose-built viewers. Neither format supports the AI Summary feature (image and PDF analysis is out of scope). The "Preview" button is also hidden for these file types.

### Content Views

#### AI Summary

The editor pane has a three-way view toggle: **source / preview / summary**.

| File | Role |
|------|------|
| `client/src/components/layout/EditorArea.tsx` | Owns `editorView` state (`'source' \| 'preview' \| 'summary'`). Renders the `🤖 Summary` button for any non-image, non-PDF file when a workspace is open. Streams `text_delta` SSE events from the server and renders partial Markdown progressively. Provides a `↺ Regenerate` button to clear the in-session cache and re-run. Accepts `summaryRequestPath` prop to open in summary view when triggered externally (both files and directories). |
| `client/src/api/files.ts` | `getAiSummary(workspacePath, filePath, isDirectory?)` probes the cache (`GET /api/ai-summary` or `/api/ai-directory-summary`). `generateAiSummary(workspacePath, filePath, provider, model, isDirectory?)` POSTs to the generate endpoint, collects the full SSE stream, and returns `{ content }`. |
| `server/src/routes/aiSummary.ts` | `GET /api/ai-summary?path=` and `GET /api/ai-directory-summary?path=` check the disk cache. `POST /api/ai-summary/generate` and `POST /api/ai-directory-summary/generate` stream LLM-generated summaries, then write to cache. |
| `server/src/prompts/summarySystem.ts` | Exports `SUMMARY_SYSTEM_PROMPT` — the file-level summary system prompt used by all three providers. |
| `server/src/prompts/directorySummarySystem.ts` | Exports `DIRECTORY_SUMMARY_SYSTEM_PROMPT` — the directory-level summary system prompt. |

**File cache path:** `~/.iodine/<workspace-md5>/<relpath-md5>/<file-content-md5>_ai_summary.md`
**Directory cache path:** `~/.iodine/<workspace-md5>/<relpath-md5>/<dir-contents-md5>_ai_dir_summary.md`
Each file/directory gets its own directory (keyed by `<relpath-md5>`), so the `latest` symlink is per-file, not global.

**Obsolete summary handling:** After generating a new summary, the server removes all other `*_ai_summary.md` files in that directory (keeping exactly one hash file), then creates/updates a `latest_ai_summary.md` symlink pointing to it. On `GET`, if the exact content hash misses, the server falls back to the `latest` symlink and returns `{ content, obsolete: true }`. The client uses this flag to show the "📖 View Summary" button with an amber background and the "↺ Regenerate (Obsolete)" button in orange inside the summary view. Both indicators clear after a fresh generation completes.

**Directory summary** is accessible via the `+` hover menu on any folder in the file tree ("View/Generate Summary"). Directories open as synthetic tabs with `isDirectory: true`; `WorkbenchLayout` calls `handleDirSummary` which opens the tab and sets `summaryRequestPath`, triggering `EditorArea` to auto-switch to summary view and start generation.

**Provider/model state** is owned by `WorkbenchLayout` and passed down to `RightPanel`, `CodingAssistant`, `SystemView`, and `EditorArea` so all features share the same selection.

#### Outline / Table-of-Contents Sidebar Panel

When a file is in **Preview** or **AI Summary** mode the activity bar's third icon (document outline) becomes active and the sidebar automatically switches to the **Outline** panel. The panel lists all headings from the rendered content, indented by level. Clicking a heading scrolls to it; the active heading updates automatically as the user scrolls.

| File | Role |
|------|------|
| `client/src/types/index.ts` | `SidebarView` union includes `'outline'` as the third value. |
| `client/src/components/layout/ActivityBar.tsx` | Adds `OutlineIcon` (document SVG) as the 3rd nav item. |
| `client/src/components/sidebar/OutlinePanel.tsx` | Parses Markdown content into `HeadingEntry[]` with `parseHeadings` (regex on `#`-prefixed lines, deduplicates same-text ids by appending `-N`). Renders flat full-width rows; active item gets accent background (`var(--color-accent)22`) + 3px inset left bar + `--color-text-active` (white/black) bold text; hover fills the row with `--color-bg-hover`. No bullet prefix. |
| `client/src/components/layout/Sidebar.tsx` | Renders `<OutlinePanel>` when `activeView === 'outline'`. Accepts `outlineContent`, `onOutlineNavigate`, and `activeHeadingId` props. |
| `client/src/components/layout/EditorArea.tsx` | Fires `onEditorViewChange` on view change. Fires `onSummaryContentChange` per streamed chunk. `onActiveHeadingChange` prop receives the dedup-resolved heading id on every scroll event. `trackActiveHeading(container)` walks heading elements, counting occurrences to produce the same dedup ids as `parseHeadings`. `scrollToHeading(id)` applies the same walk to locate the Nth-occurrence element rather than querying by DOM id directly (DOM ids may be non-unique). |
| `client/src/components/layout/WorkbenchLayout.tsx` | Passes `onActiveHeadingChange={setActiveHeadingId}` to EditorArea so scroll events update the highlighted heading. `handleEditorViewChange` switches sidebar to `'outline'` on both `'preview'` and `'summary'`. |

**Deduplication:** `parseHeadings`, `trackActiveHeading`, and `scrollToHeading` all apply the same algorithm — walk headings in document order, count occurrences of each base id, emit `base` for the first and `base-N` for the Nth duplicate. This ensures the outline ids, the scroll tracker, and the element finder all agree even when a document has repeated heading text.

**Auto-switch flow:**
1. User clicks **👁 Preview** or **✨ Summary** → `EditorArea` fires `onEditorViewChange('preview'|'summary')`.
2. `WorkbenchLayout.handleEditorViewChange` sets `activeView = 'outline'` → sidebar switches panels.
3. For summary: `onSummaryContentChange` streams generated text into `summaryOutlineContent` → outline populates live.
4. User scrolls → `trackActiveHeading` fires → `setActiveHeadingId` → active item highlights in the outline. Suppressed for 1200 ms after a programmatic `scrollToHeading` call (`suppressTrackingUntilRef`) so the outline doesn't jerk through intermediate positions during smooth scroll.
5. User clicks a heading → `handleOutlineNavigate(id)` → `scrollToHeading(id)` → correct container scrolls smoothly.
6. User clicks **⌨ Source** → sidebar reverts to `'explorer'`.

#### Source / Preview Scroll Sync

When toggling between the **source** (Monaco) and **preview** (rendered Markdown) views of a `.md` file, the editor preserves the approximate reading position using a scroll-percentage approach.

| File | Role |
|------|------|
| `client/src/components/layout/EditorArea.tsx` | Owns `scrollPercentageRef` (0–1 ratio), `previousViewRef` (last active view), and `previewRef` (DOM ref on the preview `<div>`). `captureScrollPercentage()` snapshots the ratio before a view switch; `restoreScrollPercentage(view)` applies it in the new view using a double-`requestAnimationFrame` to wait for layout. |

**Flow:**
1. User clicks the `👁 Preview` / `⌨ Source` button → `captureScrollPercentage()` is called synchronously, then `setEditorView(...)` queues the React update.
2. A `useEffect` keyed on `[editorView]` detects the change via `previousViewRef` and calls `restoreScrollPercentage(newView)`.
3. The double-RAF pattern (`rAF → restore → rAF → restore`) handles both React's render frame and the browser's layout frame so dimensions are available before scrolling.
4. `onScroll={captureScrollPercentage}` on the preview div keeps the ratio current as the user scrolls, so switching back to source also lands in the right place.
5. On Monaco mount (`onEditorMount`), `restoreScrollPercentage('source')` is called so the position is correct after the editor first renders.
6. When the active file changes, both refs reset to 0 / the new view so each file starts at the top.

**Key design:** Scroll percentage (not line number) is used because the preview renders Markdown differently from the source — a 30% scroll in source maps to roughly 30% of the rendered output regardless of heading sizes or image heights.

#### Markdown Link Navigation (Wiki-style)

Relative links in Markdown preview are intercepted so they open the target file as an editor tab rather than navigating the browser to a broken URL. External (`https://`, `mailto:`) links open in a new browser tab. Hash-only links (`#section`) scroll the current preview as normal.

| File | Role |
|------|------|
| `client/src/components/layout/EditorArea.tsx` | `resolveWorkspacePath(relativePath, activeFilePath)` resolves relative paths against the active file's directory, handling `..` traversal and normalising backslashes for Windows. `resolveImageSrc` uses the same helper. The `a` component in `ReactMarkdown` intercepts clicks: external links → `window.open`; hash links → default browser behaviour; relative paths → resolve, find in `openFiles`, call `onTabClick` (already open) or `onOpenFile` (new file). If the current view is **preview** and the target ends in `.md`/`.markdown`, it also fires `onPreviewRequest(absPath)` so the destination opens in preview too. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Owns `previewRequestPath` state. Passes `onOpenFile` (calls `openFile` with a synthetic `FileNode`), `onPreviewRequest` (sets `previewRequestPath`), `previewRequestPath`, and `onPreviewHandled` (clears it) to EditorArea. |

**Path resolution — Windows support:** `resolveWorkspacePath` normalises both `activeFilePath` and `relativePath` to forward slashes before processing, then re-attaches the correct root prefix (`/` on Unix, `C:/` on Windows) so the resolved absolute path matches the values stored in `openFiles`.

**Wiki navigation flow** (applies to both explicit links and inline code path clicks):
1. User is in **preview** or **summary** mode and activates a relative link/path.
2. `wikiNavigate(absPath)` (a `useCallback` in `EditorArea`) opens or switches to the file, then fetches `GET /api/ai-summary?path=<relPath>`.
3. **If a cached summary exists** → calls `onSummaryRequest(absPath)` → WorkbenchLayout sets `summaryRequestPath` → EditorArea's summary request effect fires, opening the file in summary view.
4. **If no cached summary and target is `.md`/`.markdown`** → calls `onPreviewRequest(absPath)` → WorkbenchLayout sets `previewRequestPath` → EditorArea's preview request effect fires, opening in preview view.
5. **Otherwise** (no summary, non-markdown) → file opens in source view.
6. Both request effects are declared after the file-switch reset effect, so they reliably override the `'source'` reset.

If the user navigates from **source** view, `wikiNavigate` is not called — links open the file in source mode as normal.

**Inline code path auto-linking:** In both preview and summary views, any inline backtick span whose text matches a relative file path pattern (no spaces, contains `/`, only path-safe characters — e.g. `` `client/src/hooks/useOpenFiles.ts` ``) is automatically rendered as a clickable link with a dotted underline. No special markdown syntax is required in the source; the renderer detects paths at render time. Clicking calls `wikiNavigate` (same as explicit link navigation — prefers cached summary, falls back to preview for `.md`). Block code fences are unaffected (they carry a `className` and pass through unchanged). The detection itself lives in `client/src/utils/filePath.ts` (`looksLikePath`); `inlineCodeComponent` (a `useCallback` in `EditorArea`) calls it and is passed as `code:` to both ReactMarkdown instances (preview and summary). The clickable span is the shared `FilePathLink` component, which the Coding Assistant also uses — see **File Path Links in Coding Assistant Output**.

#### Editor View Persistence & Back/Forward Navigation

The editor remembers which view (source / preview / summary) the user last used for each file, and restores both the view and the scroll position when they return. A `←` / `→` pill pair in the breadcrumb bar lets users navigate backward and forward through their file-visit history (up to 20 entries).

| File | Role |
|------|------|
| `client/src/components/layout/EditorArea.tsx` | `viewByPathRef` (`useRef<Map<string, EditorView>>`) stores the last view per file. `scrollByPathRef` (`useRef<Map<string, number>>`) stores the scroll percentage (0–1) per file. On file switch the effect restores both; for source Monaco is handled by `onEditorMount` → `restoreScrollPercentage('source')`; for preview/summary `restoreScrollPercentage` is called directly from the file-switch effect (with double-rAF) because `editorView` may not change if the user stays in the same view. Monaco scroll is tracked via `editor.onDidScrollChange` registered in `onEditorMount`; preview/summary scroll is saved in their `onScroll` handlers. |
| `client/src/components/layout/WorkbenchLayout.tsx` | `nav: { stack: string[], index: number }` state holds the history (capped at 20). `pushNav` truncates any forward history then appends the new path (no-op if the path equals the current head). `navBypassRef` (a `useRef<boolean>`) is set to `true` before a programmatic back/forward navigation so the push effect skips it. A `useEffect([activeFilePath])` pushes each user-initiated tab switch; it clears `navBypassRef` if it was set (back/forward case) or calls `pushNav` (normal case). `goBack` / `goForward` set the bypass ref, update the index, then call `setActiveFilePath` (file already open) or `openFile` (file was closed). |

**Back/forward bypass pattern:**
```
goBack() called
  → navBypassRef.current = true
  → setNav({ index: newIndex })
  → setActiveFilePath(targetPath)   ← triggers re-render + effect
useEffect([activeFilePath]) fires
  → navBypassRef.current is true → reset to false, skip pushNav
```
This guarantees that navigating back/forward never adds a new entry to the stack.

### Workspace and Tooling Features

#### Build Assistant

The **Build** tab in the right panel provides three sections — **Test**, **Build**, and **Build & Run** — each with an editable command field, an AI **Generate** button, and an **Execute** button. A **Save** button at the bottom persists all three commands to disk and reloads them automatically on the next workspace open. An **Open URL** section at the bottom of the scrollable area lets the user open any URL as an iframe tab in the editor.

| File | Role |
|------|------|
| `client/src/components/right/BuildAssistant.tsx` | UI component. Loads saved config from `GET /api/build-config` on workspace change. Streams AI-generated commands via `POST /api/build-config/generate`. Execute calls `runCommandInTerminal(cmd)` which opens a new terminal tab pre-loaded with the command. Accepts `onOpenUrl?(url)` prop; the "Open URL" section normalises the input (prepends `https://` if no protocol), then calls `onOpenUrl`. |
| `server/src/routes/buildConfig.ts` | `GET /api/build-config` reads `~/.iodine/{md5}/build-config.json`. `PUT /api/build-config` writes it. `POST /api/build-config/generate` probes the workspace for project type (package.json scripts, Makefile targets, Cargo.toml, etc.) and streams a single shell command from the selected LLM. |
| `client/src/components/bottom/TerminalPanel.tsx` | Converted to `forwardRef`. Exposes `TerminalPanelHandle.runCommand(cmd)` which creates a new tab with `ws://localhost:3001/terminal?cwd=…&cmd=…` — the server spawns the shell with `-c cmd` automatically. The tab label shows the command's first token. |
| `client/src/components/bottom/BottomTray.tsx` | Converted to `forwardRef`. Exposes `BottomTrayHandle.runCommand(cmd)` which activates the Terminal tab then delegates to `TerminalPanel`. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Holds `bottomTrayRef` and creates `runCommandInTerminal` callback, threading it to `RightPanel`. Also creates `handleOpenUrl` which calls `openUrl(url)` from `useOpenFiles`. |
| `client/src/components/layout/RightPanel.tsx` | Adds "Build" tab between Coding Assistant and System View. Passes `runCommandInTerminal` and `onOpenUrl` to `BuildAssistant`. |

**Persistence path:** `~/.iodine/{MD5(workspacePath)}/build-config.json`

#### URL Iframe Tabs

Any URL can be opened as a tab in the editor area, rendering an `<iframe>` instead of source code. This is useful for viewing local dev servers, documentation, or any web content alongside the code.

| File | Role |
|------|------|
| `client/src/types/index.ts` | `OpenFile` gains `isUrl?: boolean` and `url?: string` fields. |
| `client/src/hooks/useOpenFiles.ts` | `openUrl(url)` creates an `OpenFile` entry with `isUrl: true`, using `__url__:<url>` as the unique path key and the URL's hostname as the display name. No content fetch. `refreshFile` skips URL tabs. Exposed in the hook's return value. |
| `client/src/components/layout/EditorArea.tsx` | After the PDF branch, checks `activeFile.isUrl` and renders `<iframe src={url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups …">`. URL tabs are excluded from the AI summary button, the preview button, and the diff hook. |
| `client/src/components/editor/EditorTabs.tsx` | Renders a 🌐 globe icon before the tab name when `file.isUrl` is true. |

**Tab key:** URL tabs use `__url__:<url>` as their `path` to avoid collisions with real file paths. Opening the same URL twice activates the existing tab rather than creating a duplicate.

### Coding Assistant

#### User Visual Context in Coding Assistant

When the user sends a message, the coding assistant automatically appends the currently visible lines (or selected text) from the Monaco editor to the API request as a **User Visual Context** block. The UI displays only the user's typed message; the context is invisible to the user but available to the LLM.

| File | Role |
|------|------|
| `client/src/components/editor/MonacoEditor.tsx` | Accepts `onEditorMount` prop; calls it with the Monaco editor instance once mounted. |
| `client/src/components/layout/EditorArea.tsx` | Stores the editor instance in `monacoEditorRef`. Exposes `getVisibleContext()` on `EditorAreaHandle`, which reads the selection (if non-empty) or the first visible range and returns line-numbered text. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Creates `getEditorContext` callback (`editorAreaRef.current?.getVisibleContext()`) and passes it to `RightPanel`. |
| `client/src/components/layout/RightPanel.tsx` | Threads `getEditorContext` through to `CodingAssistant`. |
| `client/src/components/right/CodingAssistant.tsx` | Calls `getEditorContext()` in `handleSend` and passes the result to `sendMessage`. |
| `client/src/hooks/useCodingAssistant.ts` | `sendMessage` accepts `editorContext?: string \| null`. If present, appends it as a fenced code block under `**User Visual Context**` in the API history entry only (not in the UI message). |

#### Coding Assistant Context Chips ("Add to Context")

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

#### Right Panel & Provider/Model Display

The right panel contains three tabs: **Coding Assistant**, **Build**, and **System View**. Each tab can use a different LLM provider and model. The **Provider/Model callout** (showing current provider name and model label) appears above all three tabs *except* the Coding Assistant tab, where the provider and model are set directly within the chat UI and displaying them would be redundant.

| File | Role |
|------|------|
| `client/src/components/layout/RightPanel.tsx` | Conditionally renders the Provider/Model info box only when `activeTab !== 'assistant'`. The callout is hidden for the Coding Assistant tab to avoid redundancy. |

#### Commit Message Composition and SCM View Mounting

The `git_commit_compose` tool populates the Source Control commit editor through the `iodine:git-commit-compose` browser event. The event listener must live in the always-mounted `WorkbenchLayout`, not in the conditionally mounted `SourceControlPanel`; otherwise an event fired while another sidebar view is active is lost before the SCM panel mounts.

| File | Role |
|------|------|
| `client/src/components/layout/WorkbenchLayout.tsx` | Owns `pendingCommitMessage`, listens for `iodine:git-commit-compose`, stores the message, and switches `activeView` to `'scm'`. Passes the pending value and clear callback down to the SCM panel. |
| `client/src/components/sidebar/SourceControlPanel.tsx` | Uses an effect keyed by the pending-message prop. Once mounted, calls `sc.setCommitMessage(pendingCommitMessage)` and then clears the parent state so the message is applied exactly once. |

**Required flow:** event → parent stores message → parent opens SCM → panel mounts → effect applies message → parent clears message. Keep cross-view event listeners in a stable ancestor whenever handling the event may itself cause the destination component to mount.

#### Conversation History Persistence

Completed conversations are automatically saved to disk and surfaced in the empty state so the user can resume them after a browser refresh.

**Storage:** Each conversation is a JSON file at `~/.iodine/<workspace-md5>/conversations/<conversationId>.json`. The workspace hash is the same MD5 used elsewhere in the cache hierarchy. Up to 3 most-recent conversations (by `timestamp`) are returned by the server; there is no automatic pruning of older files beyond what the user explicitly clears.

**Empty state UI:** When there are no UI messages and at least one past conversation exists, the chat area shows a "Recent" list instead of the default "Ask about your code" placeholder. Each row displays a formatted timestamp (e.g. "Today at 2:34 PM" or "Aug 6, 2026 at 11:00 AM") and a message count. Clicking a row restores the full conversation. A "Clear all" button removes all saved conversations for the current workspace. Typing and sending a new message starts a fresh conversation with a new ID.

**Save trigger:** Conversation is written to disk inside the `done` SSE handler, after the assistant message is finalized. A nested `setUiMessages(prev => { ...; return prev })` pattern reads the latest state without causing an extra render. Transient flags (`isStreaming`, `pending`, approval `status: 'pending' → 'rejected'`) are stripped via `normalizeForSave()` before writing.

| File | Role |
|------|------|
| `client/src/api/conversations.ts` | `fetchConversations(workspacePath)`, `saveConversation(workspacePath, record)`, `clearConversations(workspacePath)` — thin wrappers around the REST API. |
| `client/src/hooks/useCodingAssistant.ts` | Accepts `workspacePath` as a 3rd parameter. Owns `conversationIdRef` (reset on `clearMessages`, reused on `loadConversation`). Saves on every completed reply. Exposes `loadConversation(record)` and `clearAllConversations()`. |
| `client/src/components/right/CodingAssistant.tsx` | `pastConversations` state fetched on mount and on workspace change. `handleClearAll` calls `clearAllConversations` and resets local state. Renders conversation list or default placeholder based on `pastConversations.length`. |
| `server/src/routes/conversations.ts` | `GET /api/conversations?workspacePath=` returns last 3 sorted by timestamp. `POST /api/conversations` writes `<id>.json`. `DELETE /api/conversations?workspacePath=` removes all `.json` files in the workspace's conversations dir. |

### Workspace Management

#### Project Metadata (Download / Import / Clear)

The **Project** menu (visible only when a workspace is open) manages the workspace's `~/.iodine/<workspace-md5>/` cache directory, which holds AI summaries and build config.

| Action | Client | Server |
|--------|--------|--------|
| Download | `downloadProjectMetadata()` in `client/src/api/files.ts` fetches the endpoint, receives a blob, and triggers a browser download via a temporary object URL | `GET /api/project/metadata/download` — spawns `zip -r - .` from the cache dir and pipes stdout to the response as `application/zip` |
| Import | `importProjectMetadata(file)` POSTs the raw `File` object as `application/octet-stream` | `POST /api/project/metadata/import` — uses `express.raw()` to receive the zip body, writes it to a temp file, runs `unzip -o`, then cleans up |
| Clear | `clearProjectMetadata()` sends `DELETE` | `DELETE /api/project/metadata` — calls `fs.rm(cacheDir, { recursive: true, force: true })` |

The server route is in `server/src/routes/project.ts`, registered at `/api/project` in `server/src/app.ts`. The Project menu is in `client/src/components/layout/MenuBar.tsx`; "Clear Metadata" shows a custom confirm dialog before deleting.

### Agent Runtime

#### Agent File Editing Tools

The coding assistant has two tools for writing files, each suited to a different use case:

| Tool | When to use | Behaviour |
|------|------------|-----------|
| `edit_file(path, old_string, new_string)` | Modifying an existing file | Reads the file, verifies `old_string` matches **exactly once**, replaces it, writes back. Returns an error if the string is missing or ambiguous — the model then reads the file and retries with more surrounding context. |
| `write_file(path, content)` | Creating a brand-new file | Writes the full content; creates parent directories as needed. |

The system prompt lives in **one place** — `systemPrompt.ts`'s `buildSystemPrompt(activeFile, tutorMode)` — and all three providers call it. It instructs the model to prefer `edit_file` for modifications and reserve `write_file` for new files only (this avoids sending entire large files as output tokens when only a few lines change), and to **fall back to `write_file` (read fully, then rewrite fully) when `edit_file` fails to apply cleanly after a retry or the target block is ambiguous/repeated**.

| File | Role |
|------|------|
| `server/src/services/fileTools.ts` | `edit_file` executor: reads file, counts occurrences of `old_string`, rejects on 0 or >1 matches with an actionable error message, replaces and writes back. Schema registered in `TOOL_SCHEMAS` (auto-picked up by all three provider tool lists). |
| `server/src/services/systemPrompt.ts` | **Single source of truth** for the shared system prompt: workspace/active-file context, the `edit_file`-vs-`write_file` guidance including the ambiguity/failure fallback, and the tutor-mode addendum. Reads `rootPath` directly from state. |
| `server/src/services/anthropicAgent.ts` | Imports and calls `buildSystemPrompt(activeFile, tutorMode)` when no `customSystemPrompt` is supplied. No inline prompt. |
| `server/src/services/geminiAgent.ts` | Same — imports and calls `buildSystemPrompt`. No inline prompt. |
| `server/src/services/openaiAgent.ts` | Same — imports and calls `buildSystemPrompt`. |

**Error messages the model receives:**
- `old_string not found` → model re-reads the file and retries with exact text
- `old_string matches N locations` → model adds more surrounding lines to make the match unique

#### Reverting Agent Edits

Successful `write_file` and `edit_file` tool blocks show a **Revert** button in their expanded panel, which puts the file back to its contents from before that edit.

| File | Role |
|------|------|
| `server/src/services/editSnapshots.ts` | `saveSnapshot` records the file before an edit to `~/.iodine/<workspace-md5>/edits/<toolCallId>.json`; `revertEdit` restores it and returns a discriminated `not-found` / `stale` / `reverted` / `deleted` result. |
| `server/src/services/fileTools.ts` | `executeTool` takes an optional `toolCallId` and snapshots immediately before `writeFileContent` in both write paths. `agentTools.ts` passes the id through. |
| `server/src/routes/agent.ts` | `POST /api/agent/revert` with `{ toolCallId, force? }` maps the service result to a status code and nothing else. |
| `client/src/components/right/RevertButton.tsx` | Owns the idle → reverting → stale → reverted states. A `stale` result swaps the button for an inline callout naming the file, offering **Revert anyway** (retries with `force`) and **Cancel**. |
| `client/src/components/right/CodingAssistant.tsx` | `ToolBlock` renders the button; `handleEditReverted` refreshes the file tree and enqueues an `edit_reverted` event context so the model stops assuming the edit is applied. |

**Key details:** snapshots are keyed by tool call id, which the client already holds as `block.id`, so `ToolResult` and the three provider agents are untouched. `existed: false` marks a file the agent created, so reverting deletes it rather than writing an empty file. `afterHash` is the file right after the edit — if it no longer matches, something else changed the file and the revert asks before overwriting. A snapshot is consumed on success, making revert one-shot. The button sits in the expanded panel because the collapsed row is itself a `<button>`. Files touched by `run_terminal_command` are not snapshotted.

#### Tutor Mode

The **Tutor** toggle in the Coding Assistant (left of the Send button) switches the AI into a read-only guidance mode: it walks through the codebase, points to relevant lines, and tells the user what to change without writing any code itself.

| File | Role |
|------|------|
| `client/src/components/right/CodingAssistant.tsx` | Owns `isTutorMode` state; renders the **Tutor** toggle button; passes `isTutorMode` to `sendMessage` and `onNavigateToLine` to `useCodingAssistant`. |
| `client/src/hooks/useCodingAssistant.ts` | `sendMessage` accepts `tutorMode?: boolean`; includes it in the POST body to `/api/agent/chat`; handles the new `open_file` SSE event by calling `onNavigateToLine(filePath, line, endLine)`. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Creates `handleNavigateToLine` which calls `openFile` then (after 100 ms) `editorAreaRef.current?.navigateToLine`. Threads to `RightPanel`. |
| `client/src/components/layout/RightPanel.tsx` | Accepts and passes `onNavigateToLine` to `CodingAssistant`. |
| `client/src/components/layout/EditorArea.tsx` | `EditorAreaHandle` now exposes `navigateToLine(filePath, line, endLine?)`. Stores pending navigation in `pendingNavigationRef`; applies it immediately when the editor is already active, or in `onEditorMount` when a new file mounts. Uses `editor.revealLineInCenter` + `editor.deltaDecorations` with CSS classes `tutor-line-highlight` / `tutor-line-gutter`. |
| `client/src/index.css` | `.tutor-line-highlight` (blue background tint) and `.tutor-line-gutter` (3 px blue left bar) decoration classes. |
| `server/src/routes/agent.ts` | Extracts `tutorMode` from request body; passes to all three agent loop functions. |
| `server/src/services/anthropicAgent.ts` | Appends `TUTOR_SYSTEM_ADDENDUM` to system prompt when `tutorMode` is true. |
| `server/src/services/openaiAgent.ts` | Same tutor mode addendum applied to `buildSystemPrompt`. |
| `server/src/services/geminiAgent.ts` | Same tutor mode addendum applied to `buildSystemInstruction`. |
| `server/src/services/fileTools.ts` | Adds `open_file` tool schema (path, line, end_line). |
| `server/src/services/agentTools.ts` | Handles `open_file` tool by emitting `open_file` SSE event then returning success; no filesystem writes occur. |

**open_file SSE event payload:** `{ path: string, line: number, endLine: number }` — sent before the tool result so the client can navigate while the agent loop continues.

**Tutor protocol (enforced by system prompt):**
1. Turn 1 — AI reads files silently, presents a numbered plan, asks "Ready to start?"
2. Turn 2+ — on each user reply, opens exactly ONE file, highlights the relevant lines, explains, then stops.
Never more than one `open_file` call per response turn.

#### Planning Mode

The **Plan** toggle in the Coding Assistant (left of the Mentor toggle; also `Shift+Tab` inside the chat textarea) switches the assistant into a two-phase Claude-Code-style workflow: read-only research → structured plan → user approval → step-tracked execution.

**Phases and enforcement:**

| Phase | Trigger | Toolset given to the model | Enforcement |
|-------|---------|---------------------------|-------------|
| Planning | `planningMode: true` in POST body | Read-only (`read_file`, `list_directory`, `search_files`, `open_file`, `invoke_summary`) + `propose_plan` | Mutating tools removed from schemas AND rejected in `executeAgentTool`; plan-mode addendum appended to system prompt (overrides the Mentor addendum's editing permission) |
| Execution | `planActive: true` + `editApproval: 'auto'\|'manual'` | Full toolset + `update_plan_step` | Execution addendum requires a `update_plan_step` call after every completed step |

| File | Role |
|------|------|
| `client/src/components/right/CodingAssistant.tsx` | Owns `isPlanningMode` state; renders the **Plan** toggle; Shift+Tab cycles Normal↔Plan; passes `isPlanningMode` as the last arg of `sendMessage`. Renders `PlanBlock` / `EditApprovalBlock`. |
| `client/src/components/right/PlanBlock.tsx` | Plan card: checklist with per-step done state + summaries, status pill (`proposed/approved/executing/paused/completed`). Buttons: **Approve & Execute**, **Review Each Edit**, **Give Feedback** (proposed); **Resume Execution** (paused). |
| `client/src/components/right/EditApprovalBlock.tsx` | Per-edit approval card shown while executing with `executionMode: 'manual'`: op badge, path, change preview, Apply/Skip buttons. |
| `client/src/utils/planContext.ts` | Pure helpers: `isPlanActive`, `formatPlanState` (builds the invisible `<PlanState>` block), `latestPlanFromMessages` (restores plan memory from persisted messages on reload). Unit-tested in `planContext.test.ts`. |
| `client/src/hooks/useCodingAssistant.ts` | Maintains `activePlanRef` — durable memory of the active plan across requests/restarts. Handles SSE `plan`, `plan_update`, `edit_approval` events; injects `<PlanState>` into every request's apiContent while a plan is approved/executing/paused; marks the plan `paused` when stopped mid-execution; exposes `approvePlan(id, mode)`, `resumePlan()`, `sendEditApproval(id, approved)`. Sends `planningMode`/`planActive`/`editApproval` in the POST body. |
| `server/src/prompts/planningSystem.ts` | `PLANNING_MODE_ADDENDUM` (research-only, propose via tool, iterate on feedback) and `PLAN_EXECUTION_ADDENDUM` (follow steps in order, record each, resume from first pending) + `planEditApprovalAddendum()` for manual mode. Composed in `buildSystemPrompt(activeFile, tutorMode, planOptions)`. |
| `server/src/services/fileTools.ts` | `TOOL_SCHEMAS` gains `propose_plan(title, steps[])` and `update_plan_step(index, summary)`; exports `selectToolEntries(planning?, executing?)` used by all three providers instead of the raw schema map, plus `MUTATING_TOOL_NAMES` and `EDIT_APPROVAL_TOOL_NAMES`. |
| `server/src/services/editApproval.ts` | Manual-edit approval flow cloned from terminal commands: emits SSE `edit_approval`, parks a resolver keyed by id (5-min timeout), resolved via `POST /api/agent/edit/approval`. |
| `server/src/services/agentTools.ts` | Handles `propose_plan` (emits `plan`) and `update_plan_step` (emits `plan_update`). Hard gate: mutating tools return an error result when `planningMode` is set; `edit_file`/`write_file` route through `requestEditApproval` when `editApproval: 'manual'`. All three agent loops accept a trailing `AgentToolOptions { planningMode, executing, editApproval }` param. |
| `server/src/routes/agent.ts` | Extracts `planningMode`, `planActive`, `editApproval` from the chat body into `planOptions`; new `POST /agent/edit/approval` route. |
| `server/src/routes/conversations.ts` | `isValidUiBlock` whitelists `plan` and `edit-approval` blocks so conversations containing them persist. |

**New SSE events:** `plan { title, steps[] }` → client creates a proposed plan block; `plan_update { index, status:'done', summary }` → patches the matching plan block across messages (the block usually lives in an earlier message than the streaming one); `edit_approval { id, op, path, preview }` → renders an approval card that resolves server-side execution.

**Plan memory:** plan state lives in persisted `uiMessages` (like command-approval blocks). On conversation load, the most recent plan block rebuilds `activePlanRef`; a plan saved mid-execution reopens as `paused`. While active, `<PlanState title=… status=… editApproval=…>` listing completed steps (with change summaries) and pending steps is injected invisibly ahead of the user text, so stopping, asking questions, or restarting never loses track.


### Navigation and System View

#### File Explorer Auto-Expand

When a file becomes active in the editor (opened by click, Tutor Mode navigation, or any other means), the file explorer automatically expands all ancestor folders so the file is visible in the tree.

| File | Role |
|------|------|
| `client/src/components/layout/WorkbenchLayout.tsx` | Passes `activeFilePath` directly as the `expandToPath` prop to `Sidebar` — no separate state needed. |
| `client/src/components/layout/Sidebar.tsx` | Threads `expandToPath` through to `FileExplorer`. |
| `client/src/components/sidebar/FileExplorer.tsx` | A `useEffect` keyed on `[expandToPath, tree]` (not `expandedPaths`) splits the path into segments and calls `toggleExpand(parentPath, true)` for each ancestor. `expandedPaths` is intentionally absent from the deps so the effect does not re-run when the user manually collapses a folder. |
| `client/src/hooks/useFileTree.ts` | `toggleExpand(nodePath, forceExpand?)` — when `forceExpand` is `true` the node is always added to `expandedPaths` regardless of its current state, preventing accidental re-collapse. |

**Key design:** Passing `activeFilePath` as `expandToPath` means every tab switch triggers a one-way expand (never collapse). The `forceExpand` flag in `toggleExpand` ensures the expand effect is idempotent and cannot fight user-initiated collapses.

#### System View — Reverse Lookup (File Explorer → Diagram)

When a system graph is loaded, **clicking any file or folder in the file explorer** automatically finds the best-matching node or edge in the diagram, selects it, and (if the user is not on the Coding Assistant tab) switches the right panel to System View and zooms to centre on the match.

Match priority for `lookupByPath(path)` (file/folder):
1. A file ref's resolved absolute path **exactly equals** the clicked path → score 2
2. A file ref's resolved path **starts with** the clicked path (folder contains the file) → score 1

Match priority for `lookupByPosition(absoluteFilePath, line)` (line-level, available for future use):
1. The line falls **within** a file ref's `line`–`endLine` range → score 3
2. The line is **within 2 lines** of a ref's `line` → score 2
3. The file path matches a ref but no line info is available → score 1

| File | Role |
|------|------|
| `client/src/components/sidebar/FileTreeNode.tsx` | `handleClick` calls `onNodeSelect?.(node)` for both file clicks and folder toggle clicks, threading the selected node up the component tree. Also passes `onNodeSelect` recursively to child `FileTreeNode` renders so nested files work. |
| `client/src/components/sidebar/FileExplorer.tsx` | Accepts `onNodeSelect` and threads it to each top-level `FileTreeNode`. |
| `client/src/components/layout/Sidebar.tsx` | Threads `onNodeSelect` to `FileExplorer`. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Holds `rightPanelRef`. `handleNodeSelect(node)` calls `rightPanelRef.current?.lookupByPath(node.path)`. Passed to `Sidebar` as `onNodeSelect`. |
| `client/src/components/layout/RightPanel.tsx` | `RightPanelHandle.lookupByPath` first checks `hasGraph()` — if no graph is loaded the call is a no-op. Otherwise calls `systemViewRef.current.lookupByPath(path)` and switches to System View **only when `activeTab !== 'assistant'`** so the Coding Assistant is never yanked away. `activeTab` is included in `useImperativeHandle` deps to prevent stale closures. |
| `client/src/components/right/SystemView.tsx` | `SystemViewHandle` exposes `hasGraph(): boolean`, `lookupByPath(path): boolean`, and `lookupByPosition(absoluteFilePath, line): boolean`. `lookupByPath` iterates all node and edge file refs, resolves each to an absolute path, scores the match, and on the best match calls `setSelected` + `setPan`/`setScale(1.2)` to centre the view. |

**Key design:** `hasGraph()` lets `RightPanel` distinguish "no graph loaded" (call is skipped entirely) from "graph loaded but no specific match found" (tab still switches so the user can see the diagram). The Coding Assistant tab guard means exploratory file clicks never disrupt an active chat session.

#### System View — Node/Edge Click → File References

Clicking a node or edge in the System View graph highlights it and opens a bottom drawer listing the source files associated with that element. Clicking a file entry navigates the editor to the specified line (same mechanism as Tutor Mode's `open_file`).

| File | Role |
|------|------|
| `client/src/api/files.ts` | `GraphFileRef` interface (`path`, `line?`, `endLine?`, `label?`). `GraphNode` and `GraphEdge` both gain an optional `files?: GraphFileRef[]` field. |
| `client/src/components/right/SystemView.tsx` | `Selected` type (`{ type: 'node'; id }` or `{ type: 'edge'; idx }`). Tracks `selected` state. `nodePressRef` / `panPressRef` refs record mouse-down position to distinguish a click (< 5 px movement) from a drag. `EdgeSvg` adds a transparent `strokeWidth={12}` hit-area path with `onMouseDown={stopPropagation}` + `onClick` to toggle edge selection; a selection highlight path (accent colour, opacity 0.35) renders behind the main path. `NodeSvg` adds a selection ring rect (accent stroke, opacity 0.8) when `isSelected`. File-references drawer renders below the SVG as a flex sibling; shows the item label, a close button, and scrollable clickable file rows. |
| `client/src/components/layout/RightPanel.tsx` | Passes `onNavigateToLine` to `SystemView` (already present in `RightPanelProps`, now threaded through). |
| `client/src/components/layout/WorkbenchLayout.tsx` | `handleNavigateToLine` (used for Tutor Mode) also serves the System View drawer — no changes needed. |
| `server/src/routes/agent.ts` | Updated `graphSystemPrompt` to instruct the AI to populate `files` arrays on nodes and edges with workspace-relative paths and line ranges from files it actually read. |

**File reference path resolution:** If `f.path` starts with `/` it is used as-is; otherwise `workspacePath + '/' + f.path` is prepended so the navigator receives an absolute path.

**Click-vs-drag:** A `Math.hypot` check at `mouseUp` ensures moves of ≥ 5 CSS pixels are treated as drags, not clicks. The SVG `onMouseLeave` fires `handleMouseUp` (which also clears refs) so stale press refs are never left behind.

### Server Runtime and Reliability

#### Terminal (PTY) Lifecycle & Cleanup

Each terminal tab opens a WebSocket to `ws://localhost:3001/terminal?cwd=…&cmd=…`. The server uses **node-pty** to spawn a pseudo-terminal (PTY) for the requested shell. Robust cleanup is critical because `tsx watch` kills and restarts the Node process on every file save, which would otherwise orphan PTY children and leak OS file descriptors until `posix_spawnp` starts failing.

| File | Role |
|------|------|
| `server/src/terminal.ts` | All active PTY instances are tracked in a module-level `activePtys: Set`. SIGTERM, SIGINT, and `process.exit` handlers call `killAllPtys()` (sends SIGKILL) so `tsx watch` restarts fully clean up open shells. Spawn uses `spawnWithRetry`: on failure it waits 250 ms and retries once to handle transient `EAGAIN` errors. `MAX_TERMINALS = 20` cap prevents runaway resource use. PTY instances are removed from the set in both `ptyProc.onExit` and `ws.on('close')` to stay accurate regardless of which side closes first. |

**Key failure mode:** `posix_spawnp failed` from node-pty is an OS-level `EAGAIN` or similar, most often triggered by accumulated file descriptors from pty processes that were not killed when the dev server restarted. The fix is the SIGTERM/SIGINT handler — when `tsx watch` sends SIGTERM before relaunching, all PTY children are killed before the process exits.

**Shell selection:** `process.env.SHELL` → `/bin/zsh` → `/bin/bash` → `/bin/sh`, with `existsSync` validation at each step.

#### System View — Active File Chip

When a System View graph is loaded, switching editor tabs automatically highlights the matching architecture node in the diagram *and* surfaces a `◎ NodeName` chip at the top of the Coding Assistant input area. Clicking the chip switches to System View and pans to the selected node.

**Flow:**
```
activeFilePath changes (editor tab switch)
  → WorkbenchLayout useEffect → rightPanelRef.current?.syncActiveFile(path)
  → RightPanel.syncActiveFile → systemViewRef.current?.selectByPath(path)
      → scores file refs, selects best match, returns node name (or null)
  → WorkbenchLayout sets activeSystemNode state
  → activeSystemNode threaded to RightPanel → CodingAssistant
  → chip renders above textarea when activeSystemNode is non-null
  → user clicks chip → onOpenNode(activeSystemNode)
      → RightPanel.handleOpenNode:
          flushSync(() => setActiveTab('system'))   ← synchronous tab switch
          systemViewRef.current?.focusSelected()    ← pans with live dimensions
```

| File | Role |
|------|------|
| `client/src/components/right/SystemView.tsx` | `SystemViewHandle.selectByPath` returns `string \| null` (matched node/edge name) so callers know which node matched. `handleGenerate` returns `SystemGraph \| null` (used internally). |
| `client/src/components/layout/RightPanel.tsx` | `syncActiveFile` returns `string \| null` (forwarded from `selectByPath`). `handleOpenNode` uses `flushSync` + `focusSelected`. `activeSystemNode` prop is threaded to `CodingAssistant`. |
| `client/src/components/layout/WorkbenchLayout.tsx` | `activeSystemNode: string \| null` state is updated by `syncActiveFile`'s return value on every `activeFilePath` change. Passed to `RightPanel`. |
| `client/src/components/right/CodingAssistant.tsx` | Accepts `onOpenNode` and `activeSystemNode` props. Shows a `◎ NodeName` chip above the textarea when `activeSystemNode` is non-null. |

**Key design decisions:**
- **Two-step select+focus:** `selectByPath` (no DOM reads, safe while SVG is `display:none`) + `focusSelected` (reads live `clientWidth`/`clientHeight` after `flushSync` makes the tab visible). Avoids the zero-dimension bug from panning a hidden SVG.
- `activeSystemNode` flows through component props so the chip appears without touching the message history.

#### System View — Auto-open on AI Summary

Whenever the user opens the AI summary view (clicks **Generate Summary** or **View Summary** in the editor), the right panel automatically switches to the System View (Iogram) tab. This happens regardless of whether a system diagram has been generated — the tab simply becomes visible so the user can see it.

| File | Role |
|------|------|
| `client/src/components/layout/EditorArea.tsx` | `onSummaryOpen?: () => void` prop; called at the top of `handleSwitchToSummary` before any async work, so the tab switches immediately on click. |
| `client/src/components/layout/RightPanel.tsx` | `RightPanelHandle.openSystemView()` calls `setActiveTab('system')`. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Passes `onSummaryOpen={() => rightPanelRef.current?.openSystemView()}` to EditorArea. |

### Proactive Assistance

#### Proactive Help System

The proactive help system monitors user activity and automatically offers assistance when it detects the user is churning — taking many actions but producing little diff output. It is designed to be modular: new signal types can be registered alongside the existing one without touching the hook.

### Architecture

```
WorkbenchLayout
  ├── useProactiveHelp()         ← generic signal runner hook
  │     ├── 1-min check interval  (fetches git diff, evaluates signals)
  │     └── 1-sec display ticker  (updates ProactiveStatus for status bar)
  ├── createIdleChurnSignal()    ← specific signal factory
  └── onTrigger callback
        ├── POST /api/proactive/rephrase  ← out-of-band LLM rephrase
        ├── playBell()                    ← Web Audio API tone
        ├── rightPanelRef.triggerPulse()  ← yellow border animation
        └── rightPanelRef.injectProactiveMessage()
              └── useCodingAssistant.injectProactiveMessage()
                    ├── appends assistant message to UI
                    └── stores collectContext for next user reply
```

### Files

| File | Role |
|------|------|
| `client/src/hooks/useProactiveHelp.ts` | Generic hook. Runs a `setInterval` at `checkIntervalMs` (default 1 min). Each tick drains `actionCountRef`, fetches overall git diff, computes `diffLineDelta`, calls `shouldFire` on each registered signal. Enforces a global `cooldownMs` (default 2 min) between any two triggers. Returns `ProactiveStatus` for the debug status bar. |
| `client/src/services/proactiveSignals.ts` | `createIdleChurnSignal` factory. Implements `ProactiveSignal` with `shouldFire`, `describe` (forward-looking reason), `collectContext` (active file + git diff), and 6 canned message variants. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Wires the signal, `onTrigger` callback, `playBell`, and proactive status into the layout. Passes `recordAction` as `onMessageSent` to `RightPanel`. |
| `client/src/components/layout/RightPanel.tsx` | Exposes `triggerPulse()` and `stopPulse()` on `RightPanelHandle`. Manages the looping `proactive-pulse` CSS animation via direct DOM class manipulation (remove → `offsetWidth` reflow → add). Auto-stops after 10 s or on first chat keystroke (`onUserTyping`). |
| `client/src/components/right/CodingAssistant.tsx` | Calls `onUserTyping()` on textarea change (stops pulse). Calls `onMessageSent()` on send (counts as an action). |
| `client/src/hooks/useCodingAssistant.ts` | `injectProactiveMessage` appends the AI message to the UI and stores `collectContext`. On the next `sendMessage`, awaits `collectContext`, prepends the result as `**Context at the time of the assistant's proactive message (for reference only — respond conversationally, do not call any tools):**` to the API payload only (not shown in UI). |
| `client/src/components/layout/StatusBar.tsx` | Thin 22 px bar below `BottomTray`. Shows live `Actions`, `Next` countdown, and forward-looking `Next check: YES / NO · quiet / NO · progress / NO · cooldown`. Only rendered when a workspace is open. |
| `client/src/index.css` | `@keyframes proactive-pulse` — inset yellow `box-shadow`, 2 s `ease-in-out infinite`. |
| `server/src/routes/proactive.ts` | `POST /api/proactive/rephrase` — non-streaming, single-turn LLM call to rephrase a canned message. Falls back to the original on any error. |

### Signal Interface

```ts
interface ProactiveSignal {
  readonly type: string;
  shouldFire(snapshot: SignalSnapshot): boolean;
  describe?(snapshot: SignalSnapshot): { fires: boolean; reason: string | null };
  collectContext(): Promise<string>;
  readonly messages: readonly string[];
}

interface SignalSnapshot {
  actionCount: number;   // actions since last check (drained atomically)
  diffLineDelta: number; // change in git diff line count vs previous check
}
```

Add new signals by implementing this interface and registering them in `WorkbenchLayout`'s `useProactiveHelp` call alongside `idleChurnSignal`.

### IdleChurn Signal — Detection Logic

```
fires when:  actionCount >= 30  AND  |diffLineDelta| < max(3, actionCount × 0.15)
```

- `actionCount >= 30` — user must be meaningfully active (not idle)
- `|diffLineDelta| < threshold` — activity is not producing output (churning)
- `diffLineDelta` is the change in total **git diff output line count** (includes headers and context lines) between two consecutive checks, not raw code lines

**What counts as an action:** editor content edits, editor scroll (throttled to one event per 3 s), tab switches, and chat messages sent.

**Status bar reasons:**
- `NO · quiet` — `actionCount < 30`
- `NO · progress` — diff growing proportionally to activity
- `NO · cooldown` — within 2-minute cooldown window

### Out-of-Band Rephrase

Before injecting the canned message, `WorkbenchLayout.onTrigger` awaits `POST /api/proactive/rephrase` with the canned message, current provider, and model. The server makes a minimal non-streaming LLM call to rephrase it naturally. On any error the original canned message is used unchanged. This call is completely outside the conversation history.

### Pulse Animation

`triggerPulse()` uses the browser's canonical animation-restart pattern:
```ts
el.classList.remove('proactive-pulse');
void el.offsetWidth;  // force reflow — browser registers removal
el.classList.add('proactive-pulse');
```
React state is not involved. The animation loops at 2 s until `stopPulse()` is called, the user types in the chat textarea, or the 10-second auto-stop fires.

### Debug Status Bar

Visible whenever a workspace is open. Forward-looking: evaluates `shouldFire` against the current live action count and the last check's `diffLineDelta` to show what the next check would do — not what the previous check did. The `describe()` method on each signal provides the human-readable reason.

#### Progress Watch

After the AI replies, the assistant arms a **progress watch** that fires once the user starts typing in the editor. The watch captures three git diff snapshots, then streams a follow-up message reviewing what changed — calling out any nits, syntax issues, or next steps.

### Flow

```
AI reply done (done SSE event)
  → armedReplyRef.current = capturedText   (silent — no timer yet)

User presses a key in the Monaco editor
  → WorkbenchLayout.onContentChange
  → rightPanelRef.notifyEditorActivity()
  → codingAssistantRef.notifyEditorActivity()
  → useCodingAssistant: armedReplyRef consumed → startProgressWatch(reply)
      → setIsWatching(true)  ← "Assistant is actively watching your progress" banner
      → sleep 4s  → fetchOverallDiff → snapshot[0]
      → sleep 6s  → fetchOverallDiff → snapshot[1]
      → sleep 10s → fetchOverallDiff → snapshot[2]
      → if any snapshot has content: runProgressCheck(reply, snapshots, controller)
            → POST /api/proactive/watch (streaming SSE)
            → onWatchTrigger() → playBell() + triggerPulse()
            → new streaming assistant message appended to chat + history
```

### Key design decisions

- **Armed, not eager**: the timer only starts on the first editor keypress after the AI reply. If the user never types, the watch never fires.
- **Cancelled on new send**: `armedReplyRef.current = null` and watch controller aborted at the start of `sendMessage` and `clearMessages`.
- **Only fires on real edits**: `onContentChange` (not `onActivity`) is used as the trigger — pure navigation/scrolls don't arm the watch.
- **Only fires with diffs**: the progress check is skipped if all three snapshots are empty (user typed but nothing was saved / no git changes).
- **Snapshot times**: 4 s, 10 s, 20 s after first editor keypress (sleep intervals: 4 s → 6 s → 10 s).

### Files

| File | Role |
|------|------|
| `client/src/hooks/useCodingAssistant.ts` | `armedReplyRef` stores the last AI reply text. `notifyEditorActivity()` consumes it and calls `startProgressWatch`. `startProgressWatch` manages the `AbortController`, sleep intervals, and diff captures. `runProgressCheck` streams `POST /api/proactive/watch` as a new assistant message. |
| `client/src/components/right/CodingAssistant.tsx` | `CodingAssistantHandle` exposes `notifyEditorActivity`. Shows yellow "Assistant is actively watching your progress" banner + glowing dot when `isWatching`. |
| `client/src/components/layout/RightPanel.tsx` | `RightPanelHandle.notifyEditorActivity` delegates to `codingAssistantRef`. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Calls `rightPanelRef.current?.notifyEditorActivity()` inside `onContentChange`. Passes `onWatchTrigger` (bell + pulse) to `RightPanel`. |
| `server/src/routes/proactive.ts` | `POST /api/proactive/watch` — streaming SSE, no tools. System prompt instructs the model to surface nits (syntax errors, typos, off-by-ones) and acknowledge progress. Snapshot labels include actual capture times (4 s, 10 s, 20 s). |

## Commit Diff Viewer

Clicking a non-HEAD commit in the Source Control history opens a full-screen overlay in the editor area showing commit metadata and a unified diff in Monaco, rather than immediately checking out the commit (which was the previous destructive default). Checkout is an explicit secondary action inside the overlay.

| File | Role |
|------|------|
| `client/src/components/editor/CommitDiffView.tsx` | Overlay component. Fetches commit data on mount. Header row: short hash (monospace accent) + subject + `+ Ask Assistant` (teal, only when data is loaded) + `⎇ Checkout` (amber) + `↗ GitHub` (when `__APP_REPO__` is set) + `✕` close. Second row: author · date. Body paragraph when non-empty. Monaco `language="diff"` read-only editor fills the rest. Custom themes defined in `beforeMount`; line-level background decorations and bright `+`/`-` prefix column decorations applied in `onMount`. Exposes `CommitDiffViewHandle.getVisibleContext()` via `forwardRef`. |
| `server/src/routes/files.ts` | `GET /api/git/commit-diff?hash=` — runs `git log -1` with a `\x1f`-separated format for metadata then `git show --format= --patch` for the diff body; returns `CommitDiffData` JSON. |
| `client/src/api/files.ts` | `CommitDiffData` interface + `fetchCommitDiff(hash)` thin wrapper. |
| `client/src/components/layout/EditorArea.tsx` | `activeCommitHash?`, `onCommitDiffClose?`, `onCommitCheckout?`, `onCommitDiffAddToContext?` props. Renders the overlay as `position:absolute; inset:0; zIndex:5` (same pattern as `MergeConflictView`). |
| `client/src/components/layout/WorkbenchLayout.tsx` | `activeCommitHash` and `commitDiffContext` states. `handleCommitCheckout` calls `checkoutBranch(hash, true)` then clears the hash. Clears `activeCommitHash` on workspace change. |
| `client/src/components/layout/Sidebar.tsx` | Threads `onCommitSelect` down to `SourceControlPanel`. |
| `client/src/components/sidebar/SourceControlPanel.tsx` | Row click → `onSelect?.(commit.hash)` (opens diff overlay). Hover reveals a `⎇` icon button (absolute, right edge) that calls `sc.checkoutCommit` directly without opening the overlay. HEAD commit row is non-clickable as before. |

**Diff color coding:** `beforeMount` registers `commit-diff-dark` / `commit-diff-light` Monaco themes with token color rules for `inserted`/`deleted`/`changed`/`token.*` tokens. `onMount` walks every line and attaches `diff-added-line` / `diff-deleted-line` / `diff-info-line` whole-line background decorations and `diff-added-prefix` / `diff-deleted-prefix` inline decorations on column 1 for bright `+`/`-` prefixes. The CSS classes live in `client/src/index.css`.

**Pass to Coding Assistant:** The `+ Ask Assistant` button in the overlay formats the commit metadata + diff as a markdown block and calls `onAddToContext(shortHash, content)`. This sets `commitDiffContext` in `WorkbenchLayout`, which threads through `RightPanel` → `CodingAssistant` as a dismissable `⎇ commit <hash>` chip above the textarea. On send, `handleSend` extracts the content, clears the chip, and passes it as `extraContext` (7th arg) to `sendMessage`. `useCodingAssistant.sendMessage` appends it as `\n\n---\n${extraContext}` to the API payload only.

## Merge Conflict Resolver

Files containing git merge conflict markers show an **⚠ Conflicts** button in the editor's floating button group. Clicking it opens a three-pane resolver as an absolute overlay (the Monaco editor stays mounted underneath, preserving AI visual context).

| File | Role |
|------|------|
| `client/src/utils/mergeConflict.ts` | Pure utilities: `hasConflictMarkers` (detection), `extractBranchNames` (reads branch names from `<<<<<<< name` / `>>>>>>> name` lines), `buildOursVersion` / `buildTheirsVersion` (produce the full file with every conflict resolved to one side), `conflictResultKey` (localStorage key). |
| `client/src/components/editor/MergeConflictView.tsx` | Three-pane layout rendered in a full-height flex column. **OURS** (left, teal `#4ec9b0`) and **THEIRS** (right, blue `#569cd6`) panes are read-only Monaco editors showing the full file with all conflicts resolved to each respective side. **RESULT** (center) is a `DiffEditor` with `renderSideBySide: false` (inline mode); `original` is `oursContent` so diffs highlight what the user has changed from the ours baseline. Branch names from the markers label each pane header. In-progress edits auto-persist to `localStorage` (keyed by `conflictResultKey(filePath)`) on every keystroke; the entry is removed on a successful save. |
| `client/src/components/layout/EditorArea.tsx` | `EditorView` union includes `'conflicts'`. `showConflictsButton` is computed from `hasConflictMarkers(activeFile.content ?? '')`. Button toggles between `'source'` and `'conflicts'`; it is hidden for images, PDFs, URL tabs, and directories. The overlay div uses `position: absolute; inset: 0; zIndex: 5` so it sits above Monaco without unmounting it. The existing `useEffect` keyed on `activeFile.path` resets `editorView` to `'source'` on tab switch. |

**Save flow:** `DiffEditor.onMount` wires the modified editor's `onDidChangeModelContent` to update `resultContent` state. Clicking **Save** calls `putFileContent(filePath, resultContent)`, removes the localStorage draft, then calls `onSaved(resolved)` which propagates the resolved content back through `onContentChange` and switches the view to `'source'`. Clicking **⌨ Source** without saving calls `onClose()` which just sets `editorView` back to `'source'`, leaving the conflicted file unchanged on disk.

## External File Open

Any file outside the current workspace can be opened from **File > Open File…** with full editor support (Monaco, save, Markdown preview, AI summary, merge conflict resolver).

| File | Role |
|------|------|
| `server/src/services/fileSystem.ts` | `readExternalFile(path)` / `writeExternalFile(path, content)` — no `validatePath` call, accept any absolute path. |
| `server/src/routes/files.ts` | `GET /api/files/external?path=` and `PUT /api/files/external` serve external reads/writes. |
| `server/src/routes/aiSummary.ts` | `GET /api/ai-summary` and `POST /api/ai-summary/generate` accept an optional `workspacePath` override so external files can be summarised using their parent directory as the effective workspace root. |
| `client/src/types/index.ts` | `OpenFile` gains `isExternal?: boolean`. |
| `client/src/api/files.ts` | `fetchExternalFileContent` / `putExternalFileContent` / `searchFiles(query, workspaceOnly?)`. |
| `client/src/hooks/useOpenFiles.ts` | `openExternalFile(absolutePath)` — creates an `OpenFile` with `isExternal: true`. `saveFile` routes external files to `putExternalFileContent`. `refreshFile` and the dirty-check skip external files. |
| `client/src/components/layout/EditorArea.tsx` | Git diff is skipped for external files. AI summary uses `path.dirname(absolutePath)` as `workspacePath` when `activeFile.isExternal`. |

## File Search (Quick Open)

Two search modes share the same dialog UI and server endpoint:

| Trigger | Mode | Scope |
|---------|------|-------|
| **File > Open File…** | external | Workspace (if open) + home dir (depth 0, hidden files included) + common dirs (`Desktop`, `Documents`, …) |
| **Search workspace… button** or **⌘P / Ctrl+P** | workspace | Open workspace root only |

**Server** (`POST /api/files/search`): accepts `{ query, workspaceOnly? }`. Internally uses typed `SearchRoot[]` entries with per-root `maxDepth` and `includeHidden` flags. Home dir is added at `maxDepth: 0` with `includeHidden: true` so dotfiles (`.bashrc`, `.zshrc`) are found without recursing into all of `~`. Skips `node_modules`, `.git`, `dist`, `build` and other noise dirs. Windows: adds `OneDrive`, `OneDrive - Personal`, `OneDrive - Business` under home when `process.platform === 'win32'`.

**Client** (`client/src/components/layout/MenuBar.tsx`):
- `openFileMode: 'workspace' | 'external'` state gates which callback (`onOpenWorkspaceFile` vs `onOpenExternalFile`) is used and which `workspaceOnly` value is sent to the server.
- Dialog is VS Code Quick Open-style: floats near the top, single search input, results render in-place as a scrollable list. Each result shows the **filename** (bold) above the **directory path** (monospace, muted). Arrow keys navigate; Enter opens highlighted result; Escape closes.
- Workspace search button (centered in menu bar, visible only when a project is open) sets mode to `'workspace'` and opens the dialog. `Cmd/Ctrl+P` also triggers workspace search.
- Opening via **File > Open File…** always forces mode to `'external'` regardless of previous state.
- `onOpenWorkspaceFile` in `WorkbenchLayout` constructs a `FileNode` and calls `openFile` so workspace files are treated as regular workspace files (saves route through the workspace API; no `isExternal` flag).

## Code Block Copy Button

Fenced code blocks in the Coding Assistant output have a **Copy** button in the top-right corner of the `<pre>` element.

| File | Role |
|------|------|
| `client/src/components/right/CodingAssistant.tsx` | `CodeBlock` component wraps `<pre className="md-pre">` and renders an absolutely-positioned button (`top: 6, right: 6`). Clicking copies the code text via `navigator.clipboard.writeText`. The button shows **Copy** normally and flashes **Copied!** (teal) for 1.5 s; a `resetTimerRef` clears any pending timer on re-click or unmount. Only fenced blocks get the button — inline `<code>` spans pass through unchanged. |

**Key details:** `children` from ReactMarkdown for a fenced block is already a plain string, so `String(children).replace(/\n$/, '')` extracts the text with no tree-walking. `type="button"` prevents accidental form submission.

## File Path Links in Coding Assistant Output

File paths in agent replies and on tool block rows are clickable and open the file.

| File | Role |
|------|------|
| `client/src/utils/filePath.ts` | `looksLikePath` is the shape check shared with preview. `parseFilePath` adds a trailing `:42`, rejects URLs, and reports the extension; callers apply their own rule. `resolveFromRoot` joins to the workspace root. |
| `client/src/components/editor/FilePathLink.tsx` | The clickable span, shared with preview. Calls `stopPropagation` so a click inside another button does not also fire it. |
| `client/src/components/right/CodingAssistant.tsx` | `pathArgument` / `lineArgument` read the tool call; `codeComponent` in `MessageBubble` links inline spans. |

**Key details:** the chat requires a file extension so prose like `and/or` and folders like `images/` stay plain text; preview keeps the looser rule. Paths resolve against the workspace root, not the active file as `resolveWorkspacePath` does. Links are suppressed while a message streams, since a partial path can match.

## Pane Toggle Buttons

Three icon buttons in the menu bar right section (left of the theme toggle) let the user show/hide the **sidebar**, **right panel**, and **bottom tray** without losing state.

| File | Role |
|------|------|
| `client/src/components/layout/WorkbenchLayout.tsx` | Owns `showSidebar`, `showRightPanel`, `showBottomTray` boolean states (all default `true`). Each pane and its `ResizeDivider` are wrapped in `<div style={{ display: shown ? 'contents' : 'none' }}>` so components stay mounted — all chat history, terminal sessions, and editor state are preserved when hidden. Toggle callbacks are passed to `MenuBar`. |
| `client/src/components/layout/MenuBar.tsx` | `PaneIcon` renders a small SVG layout diagram (15×13) for each pane type: the toggled region is filled at 45% opacity when the pane is visible, and empty when hidden. Active buttons have `var(--color-bg-hover)` background; hidden-pane buttons are dimmed to 55% opacity. A thin separator divides the pane buttons from the theme toggle. `SunIcon` and `MoonIcon` SVG components replace the previous Unicode characters for crisper rendering. |

**`display: contents` pattern:** The wrapper div with `display: 'contents'` is transparent to the flex layout — its children participate directly as flex items in the parent row/column. Switching to `display: 'none'` hides the subtree without unmounting it, so no state is lost.

## About Dialog & Update Check

**Help → About Iodine** opens a modal showing the app version. The version string is derived from `git describe --tags --always --dirty` at Vite startup/build time and injected as the compile-time constant `__APP_VERSION__` via `vite.config.ts`. The GitHub repo slug (`owner/repo`) is extracted from `git config --get remote.origin.url` and injected as `__APP_REPO__`. Both declarations live in `client/src/app-version.d.ts`. If git metadata is unavailable the strings fall back to `'development'` / `''`.

### Update Check

On startup and every 4 hours, the app fetches `https://api.github.com/repos/{__APP_REPO__}/releases/latest` and compares the release tag against `__APP_VERSION__` using semver. If a newer version is found and the user has not snoozed, an **Update available** dialog appears automatically showing the current and latest versions with two actions:

- **View release** — opens the GitHub release URL in the browser and closes the dialog.
- **Remind me in 30 days** — writes the current timestamp to `localStorage` under `iodine:update-snooze` and clears the dialog. The next check (on mount or on the 4-hour interval) skips the fetch entirely while the snooze is active.

A yellow dot appears on the **Help** menu button and an **Update available…** item appears at the top of the Help dropdown while an update is pending.

The check is a no-op when `__APP_REPO__` is empty (no git remote), when `__APP_VERSION__` is not a valid semver (e.g. a bare commit hash or `'development'`), or while the snooze is active.

| File | Role |
|------|------|
| `client/src/hooks/useUpdateCheck.ts` | Fetches GitHub Releases API, compares semver, respects localStorage snooze, returns `{ updateInfo, snooze }`. |
| `client/src/components/layout/WorkbenchLayout.tsx` | Mounts `useUpdateCheck(__APP_REPO__)` and passes `updateInfo`/`onSnoozeUpdate` to `MenuBar`. |
| `client/src/components/layout/MenuBar.tsx` | Auto-shows update dialog when `updateInfo` becomes non-null; renders yellow dot on Help button; renders dialog with View/Snooze actions. |
| `client/vite.config.ts` | `getGitRepo()` extracts `owner/repo` from the git remote URL and injects it as `__APP_REPO__`. |

## Editor View Button Theming

The floating editor-view buttons (Preview, Summary, Conflicts) use CSS variables so they adapt to light/dark mode without hardcoded colours.

| Variable | Dark fallback | Light value | Used for |
|----------|--------------|-------------|----------|
| `--summary-button-bg` | `#3a3d41` | `#e5e7eb` | Summary button idle background |
| `--summary-button-color` | `#fff` | `#374151` | Summary button idle text |
| `--editor-btn-active-bg` | `#007acc` | `#dbeafe` | All three buttons in active/Source state |
| `--editor-btn-active-color` | `#fff` | `#1e40af` | Active/Source button text |

The `.summary-action` CSS class (applied to the file-tree "Generate/View Summary" dropdown item) sets `color: #6b7280` in light mode via `:root[data-theme='light'] .summary-action`.

## Voice Memo (TTS)

Completed assistant messages longer than 120 characters show a **Voice Memo** chip (internally "Verbally") below the content. Clicking it condenses the response via LLM into a confident slide-deck narration, then speaks it aloud using the provider's TTS API. Only OpenAI and Google are supported; Anthropic users see a dialog offering to switch.

| File | Role |
|------|------|
| `server/src/routes/tts.ts` | `POST /api/tts/verbally` — accepts `{ text, provider, model }`. Step 1: calls the LLM with `NARRATION_PROMPT` to condense the response into a 2–4 sentence slide-deck narration; falls back to `text.slice(0, 1000)` on an empty completion. Step 2: calls TTS — OpenAI uses `tts-1-hd` / voice `nova` and returns `audio/mpeg`; Google uses `gemini-2.5-flash-preview-tts` with voice `Aoede`, receives base64 PCM (24 kHz, 16-bit mono), converts to WAV via `pcmToWav`, and returns `audio/wav`. |
| `server/src/app.ts` | Registers `ttsRouter` at `/api`. |
| `client/src/components/right/CodingAssistant.tsx` | `speakingMsgId`, `verballyLoadingId`, `verballyError` states + `audioRef`. `handleVerbally(msgId, text)` stops any current playback, calls the endpoint, creates a blob URL, and plays it via `new Audio(url)`. Error message surfaces in a dismissable banner above the input. Anthropic users see a modal with one-click switches to OpenAI or Google. `MessageBubble` receives `onVerbally`, `isSpeaking`, `isVerballyLoading` props; the chip is hidden for messages ≤ 120 characters. |

**Narration prompt:** Instructs the model to narrate as a confident presenter speaking live over a slide — strip code blocks, markdown, and hedging; distill to 2–4 natural spoken sentences; no self-introduction or "this slide shows".

**Provider IDs:** `'openai'` and `'google'` (not `'gemini'`) — match the values in `client/src/providers.ts`.

**Audio playback:** Only one message speaks at a time. Clicking the chip on the currently-speaking message stops it (toggle). `audio.onended` clears `speakingMsgId` and revokes the blob URL.

**Speaking indicator:** While audio plays the chip content switches to `SpeakingWave` — 7 vertical bars (2 px wide, `currentColor`) animated with `@keyframes wave-bar` (2 px → 11 px, 0.65 s ease-in-out, alternating) and staggered `animationDelay` values to produce an equalizer ripple. The bars inherit the chip's teal accent via `currentColor`.

**Tutor mode integration:** When Tutor mode is on, the Verbally chip is shown on every assistant message regardless of length (`alwaysVerbally` prop bypasses the 120-char threshold). At the end of each generation the auto-speak effect enqueues the condensed Verbally response onto the same narration queue used by tool narrations — it never interrupts them. Exploration/navigation narrations (`read_file`, `open_file`, `list_directory`, `search_files`) are marked `skippable: true` and are evicted from the queue as soon as the Verbally audio fetch resolves, so Verbally follows the current clip without waiting for remaining exploration phrases. Edit/write narrations (`edit_file`, `write_file`) are marked `skippable: false` and are always played through. The per-turn edit/write flag is reset when the turn completes, so it cannot affect a later turn. On exploration-only turns (no edit/write narrations that turn), a brief transition phrase ("Aha.", "Got it.", etc.) is inserted before Verbally to bridge the two naturally; this transition is suppressed on turns that included edit/write narrations because those already signal completion.

**Direct-speech fast path:** Auto-spoken responses under 15 whitespace-delimited words with no tool narrations that turn bypass `/api/tts/verbally` and call `/api/tts/speak` directly (no condensation).

**Greeting on first response:** The first assistant message in a new thread may be preceded by a dedicated greeting audio clip. `enqueueGreeting(mode)` in `useToolNarration` pushes a non-skippable `/api/tts/speak` clip onto the narration queue before `sendMessage` is called, guaranteeing the playback order: greeting → tool narrations → condensed response. The mode is determined at send time by snapshotting `pastConversationsRef.current.length` — `'hello'` when empty (confirmed new user), `'welcomeBack'` when entries exist. Greeting is suppressed entirely (not enqueued) when history is still loading, when the load failed, or when the thread is not new. `handleSend` reads `conversationsLoading` React state and `conversationLoadError` state directly (render closure). `transcribeAndSend` reads `conversationsLoadingRef` and `conversationLoadErrorRef` — ref mirrors kept in sync at every `setConversationsLoading` / `setConversationLoadError` call — because it runs inside a stale `useCallback` closure. `handleClearAll` zeroes `pastConversationsRef.current` so the next new thread resolves to `'hello'`. Greeting is only enqueued in tutor mode; non-tutor sessions never trigger it.

**Tutor mode tool call narration:** Each `tool_call` SSE event during a tutor-mode turn triggers a randomised short phrase from `TOOL_NARRATION_PHRASES` keyed by tool name. Narration logic lives in `client/src/hooks/useToolNarration.ts`; `git_commit_compose` has dedicated phrases such as “Let me draft a commit message.” The hook owns the `NarrationEntry` queue (`{ fn, skippable }`), generation counter, deduplication set, and per-turn `hadUnskippableRef` flag (set whenever an edit/write narration is queued, reset by `resetTurn()`). Exposed API: `narrate`, `enqueueGreeting`, `stop`, `drain`, `evictSkippable`, `resetTurn`, plus refs (`queueRef`, `audioRef`, `hadNarrationsRef`, `hadUnskippableRef`, `onEmptyRef`). The `POST /api/tts/speak` endpoint handles direct TTS without a condensation step. The queue stops on new message send, tutor mode toggle off, manual Verbally click, and component unmount.

**Tutor mode system prompt:** The scripted "Ready to start? Say go" turn-1 ending has been removed. The AI presents its plan and ends conversationally — no scripted cues like "say next" or "say go" anywhere in the prompt.

## Voice Input (STT)

A microphone button sits left of the Send button in the Coding Assistant input row. Clicking it starts recording; it auto-stops after ~1.5 s of silence and sends the transcription automatically without requiring a Send click.

| File | Role |
|------|------|
| `server/src/routes/stt.ts` | `POST /api/stt/transcribe` — accepts `{ audioBase64, mimeType, provider }`. OpenAI: forwards to Whisper (`whisper-1`) via `toFile` helper. Google: sends audio as `inlineData` to `gemini-2.0-flash` with a transcription-only prompt. Returns `{ text }`. |
| `server/src/app.ts` | Registers `sttRouter` at `/api`. |
| `client/src/components/right/CodingAssistant.tsx` | `isRecording` / `isTranscribing` states + `mediaRecorderRef`, `audioChunksRef`, `silenceTimerRef`, `recordingStreamRef`. `startRecording` requests mic permission, attaches a `MediaRecorder` and an `AnalyserNode` for per-frame RMS silence detection (threshold RMS < 5, 1.5 s hold). `stopRecording` clears the silence timer and stops the recorder. `onstop` closes the `AudioContext`, stops the stream tracks, and calls `transcribeAndSend`. `transcribeAndSend` base64-encodes the blob, POSTs to the server, and calls `sendMessage` directly on success. `MicIcon` SVG renders the button; button turns red while recording. |

**Silence detection:** `AnalyserNode` with `fftSize = 1024` reads byte time-domain data each animation frame. RMS below 5 starts a 1.5 s countdown; any louder frame resets it. Stops the recorder when the countdown expires.

**Provider support:** OpenAI and Google only — same restriction as Verbally. Anthropic users see the existing "switch provider" dialog.

**Auto-send:** After transcription succeeds, `sendMessage` is called directly with the transcribed text; the textarea is not populated.

## Implementation Notes

For the full project architecture, APIs, and feature details, inspect the relevant source files and `README.md`. Keep this document concise to preserve context-window space.
