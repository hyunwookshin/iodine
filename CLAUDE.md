# Iodine — Developer Notes

## What This Is

A web-based IDE shell for the Iodine project. Developers can open a local folder, browse its file tree, and read/edit files in a Monaco-powered code editor. The right panel has two tabs: **Simulation** (placeholder for planned network mocking / throttling features) and **Coding Assistant** (a streaming Claude-powered chat that can read, write, and search files in the open workspace).

## How to Start

```bash
# Install dependencies (first time only)
npm install

# Run both client and server
npm run dev
```

- **Client** (React + Vite): http://localhost:5173
- **Server** (Express): http://localhost:3001

Once running, open a project via **File → Open Project** in the menu bar (browser directory picker) or click **Open Folder** in the left sidebar to type an absolute path.

## Project Structure

```
iodine/
├── package.json              # Root: npm workspaces + concurrently dev script
├── tsconfig.base.json        # Shared TypeScript config
│
├── client/                   # React + TypeScript frontend (Vite)
│   ├── vite.config.ts        # Proxies /api to localhost:3001 (note: SSE bypasses proxy — see below)
│   ├── index.html
│   └── src/
│       ├── main.tsx          # React entry point
│       ├── App.tsx           # Renders WorkbenchLayout
│       ├── index.css         # Global resets + CSS variables (dark theme)
│       ├── types/index.ts    # Shared types: FileNode, OpenFile, UIMessage, UIBlock, etc.
│       ├── api/files.ts      # Typed fetch wrappers for file/workspace endpoints
│       ├── utils/
│       │   └── localFileTree.ts      # Builds FileNode tree from browser FileList (webkitdirectory)
│       ├── hooks/
│       │   ├── useFileTree.ts        # Directory tree state + expand/collapse (server or local)
│       │   ├── useOpenFiles.ts       # Open tabs, dirty tracking, save logic (server or local)
│       │   └── useCodingAssistant.ts # SSE streaming chat state + message history
│       └── components/
│           ├── layout/
│           │   ├── WorkbenchLayout.tsx   # Root layout, panel widths, Ctrl+S handler
│           │   ├── MenuBar.tsx           # Top menu bar — File > Open Project
│           │   ├── ActivityBar.tsx       # Left icon strip (Explorer / SCM toggle)
│           │   ├── Sidebar.tsx           # Panel host — renders active view
│           │   ├── EditorArea.tsx        # Tab bar + Monaco editor
│           │   ├── RightPanel.tsx        # Tab bar: Simulation | Coding Assistant
│           │   └── ResizeDivider.tsx     # Draggable column resize handle
│           ├── sidebar/
│           │   ├── FileExplorer.tsx      # Open Folder UI + file tree (server or local)
│           │   ├── FileTreeNode.tsx      # Recursive tree node component
│           │   └── SourceControlPanel.tsx # SCM placeholder
│           ├── editor/
│           │   ├── EditorTabs.tsx        # Tab strip with dirty indicator
│           │   ├── MonacoEditor.tsx      # @monaco-editor/react wrapper
│           │   └── WelcomeScreen.tsx     # Shown when no file is open
│           └── right/
│               ├── SimulationPanel.tsx   # Simulation tab content (placeholder)
│               └── CodingAssistant.tsx   # Coding Assistant chat UI
│
├── images/                   # Screenshots and visual assets for documentation
├── DEBUGGING.md              # Notes on non-obvious bugs encountered during development
│
└── server/                   # Node.js + Express backend
    └── src/
        ├── index.ts              # Entry point — listens on port 3001
        ├── app.ts               # Express app factory (CORS, JSON, routes)
        ├── state.ts             # Shared mutable state: rootPath
        ├── routes/
        │   ├── files.ts         # Route handlers for file/workspace endpoints
        │   └── agent.ts         # POST /api/agent/chat (SSE), GET /api/agent/status
        └── services/
            ├── fileSystem.ts    # Pure FS operations + path traversal guard
            └── anthropicAgent.ts # API key loading, tool execution, agentic loop
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/workspace/open` | Set workspace root `{ path }` |
| `GET` | `/api/workspace` | Get current workspace root |
| `GET` | `/api/files/tree` | Full directory tree from workspace root |
| `GET` | `/api/files/content?path=` | Read a file's text content |
| `PUT` | `/api/files/content` | Write a file `{ path, content }` |
| `GET` | `/api/agent/status` | `{ configured: true/false }` — API key present? |
| `POST` | `/api/agent/chat` | SSE stream: `{ messages, model }` → text deltas + tool events |

All file reads and writes are validated against the workspace root to prevent path traversal.

## Key Behaviors

- **Open Project (menu bar)**: Click **File → Open Project…** in the top menu bar. A native browser directory picker opens. The selected folder's tree populates the left pane immediately — no server involved (files are read client-side via the browser File API). Editing works; saves are in-memory only (the browser `<input webkitdirectory>` API does not grant write-back access to disk).
- **Open Folder (sidebar)**: Click the folder icon in the left sidebar, type an absolute path, press Enter or click Open. This sets the server-side workspace root — required for the Coding Assistant's file tools (`read_file`, `write_file`, etc.) to work. Saves write to disk via the Express API.
- **Open a file**: Click any file in the tree. It opens as a tab in the editor.
- **Save**: `Ctrl+S` / `Cmd+S`. An amber dot on the tab indicates unsaved changes.
- **Resize panels**: Drag the thin dividers between the sidebar, editor, and right panel.
- **Switch sidebar views**: Click the branch icon in the activity bar to switch between Explorer and Source Control.
- **Coding Assistant**: Click the "Coding Assistant" tab in the right panel. Requires an Anthropic API key (see below). Enter sends a message; Shift+Enter inserts a newline. Chat history persists until the page is refreshed or the ✕ button is clicked.

## Menu Bar — File > Open Project

### How It Works

The top 30px `MenuBar` component renders a "File" dropdown. "Open Project…" triggers a hidden `<input type="file">` with the `webkitdirectory` attribute set (via `setAttribute` in a `useEffect` to avoid a TypeScript JSX error). The browser presents its native folder-picker dialog.

On selection, the `FileList` is passed to `buildLocalFileTree` (`client/src/utils/localFileTree.ts`), which:

1. Iterates all `File` objects and reads `file.webkitRelativePath` (e.g. `"myproject/src/index.ts"`).
2. Reconstructs the directory hierarchy into a `FileNode` tree using that path as the node's stable `path` key.
3. Sorts each level: directories first, then alphabetically.
4. Returns `{ tree: FileNode, fileMap: Map<path, File> }`.

The tree is stored as `localTree` state in `WorkbenchLayout` and threaded down through `Sidebar → FileExplorer → useFileTree`. The file map is stored in a `useRef` inside `useOpenFiles` (via `setLocalFileMap`) so the `openFile` callback doesn't need to be recreated.

### Two Workspace Modes

| | Local (menu bar) | Server (sidebar text input) |
|---|---|---|
| Opens via | Browser directory picker | Absolute path → `POST /api/workspace/open` |
| File tree | Built in-browser from `FileList` | Fetched from `GET /api/files/tree` |
| File content | `File.text()` (browser API) | `GET /api/files/content` |
| Save | In-memory only (no disk write) | `PUT /api/files/content` → Express |
| AI agent tools | ✗ (server has no path) | ✓ |
| Works in Firefox | ✓ (`webkitdirectory` supported) | ✓ |

The two modes are mutually exclusive — opening a project via the menu bar clears `workspacePath`, and opening a folder via the sidebar clears `localTree`.

### Browser Compatibility

`webkitdirectory` is non-standard but supported in all major browsers (Chrome, Firefox, Safari, Edge). `showDirectoryPicker()` (File System Access API) was not used because it is not supported in Firefox.

## Coding Assistant

### API Key

The server reads the key in this order:

1. `~/.anthropic/api_key` (file, trimmed) — where Claude Code stores its key
2. `ANTHROPIC_API_KEY` environment variable
3. Error if neither is found (UI shows a warning banner)

### Agentic Loop

The loop runs entirely server-side (`server/src/services/anthropicAgent.ts`). The client receives only SSE events:

| SSE event | Payload | Meaning |
|-----------|---------|---------|
| `text_delta` | `{ text }` | Streamed text token |
| `tool_call` | `{ id, name, input }` | Claude is invoking a tool |
| `tool_result` | `{ tool_use_id, name, preview, error }` | Tool finished |
| `done` | `{}` | Turn complete |
| `error` | `{ message }` | Server-side error |

### Tools Available to Claude

| Tool | What it does |
|------|-------------|
| `read_file(path)` | Reads a file from the workspace |
| `write_file(path, content)` | Writes a file; creates parent dirs if needed |
| `list_directory(path?)` | Builds a directory tree (depth 3) |
| `search_files(query, path?)` | Grep-like text search across workspace files |

### Models

Selectable via dropdown in the Coding Assistant tab:

| Model ID | Label |
|----------|-------|
| `claude-sonnet-4-6` | Claude Sonnet 4.6 (default) |
| `claude-sonnet-4-5` | Claude Sonnet 4.5 |
| `claude-3-7-sonnet-20250219` | Claude Sonnet 3.7 |

### SSE and the Vite Proxy

The Coding Assistant's `fetch` calls go **directly to `http://localhost:3001`** in development, bypassing the Vite proxy. This is intentional — Vite's proxy (`http-proxy`) closes its backend connection shortly after forwarding the first SSE chunk, causing `res.on('close')` to fire on the Express side and aborting the agent loop before the Anthropic API is ever called. See `DEBUGGING.md` for full details.

Non-streaming requests (file tree, file content, workspace, status) continue to go through the Vite proxy at `/api/*` as normal.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Code editor | Monaco Editor (`@monaco-editor/react`) |
| AI API | Anthropic SDK (`@anthropic-ai/sdk`) |
| Backend | Node.js, Express 4, TypeScript |
| Dev runner | `tsx watch` (server), Vite HMR (client) |
| Monorepo | npm workspaces + `concurrently` |
