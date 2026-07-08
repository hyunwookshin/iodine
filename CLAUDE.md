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

Once running, click **Open Folder** in the left sidebar and enter an absolute path (e.g. `/Users/you/my-project`).

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
│       ├── hooks/
│       │   ├── useFileTree.ts        # Directory tree state + expand/collapse
│       │   ├── useOpenFiles.ts       # Open tabs, dirty tracking, save logic
│       │   └── useCodingAssistant.ts # SSE streaming chat state + message history
│       └── components/
│           ├── layout/
│           │   ├── WorkbenchLayout.tsx   # Root layout, panel widths, Ctrl+S handler
│           │   ├── ActivityBar.tsx       # Left icon strip (Explorer / SCM toggle)
│           │   ├── Sidebar.tsx           # Panel host — renders active view
│           │   ├── EditorArea.tsx        # Tab bar + Monaco editor
│           │   ├── RightPanel.tsx        # Tab bar: Simulation | Coding Assistant
│           │   └── ResizeDivider.tsx     # Draggable column resize handle
│           ├── sidebar/
│           │   ├── FileExplorer.tsx      # Open Folder UI + file tree
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

- **Open Folder**: Click the folder icon in the left sidebar, type an absolute path, press Enter or click Open.
- **Open a file**: Click any file in the tree. It opens as a tab in the editor.
- **Save**: `Ctrl+S` / `Cmd+S`. An amber dot on the tab indicates unsaved changes.
- **Resize panels**: Drag the thin dividers between the sidebar, editor, and right panel.
- **Switch sidebar views**: Click the branch icon in the activity bar to switch between Explorer and Source Control.
- **Coding Assistant**: Click the "Coding Assistant" tab in the right panel. Requires an Anthropic API key (see below). Enter sends a message; Shift+Enter inserts a newline. Chat history persists until the page is refreshed or the ✕ button is clicked.

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
