# Project Iodine

## About

**Iodine** is an AI-powered, web-based IDE for frontend performance simulation. It lets developers open a local project, browse and edit files in a VS Code-style interface, and simulate realistic backend conditions — such as slow responses, throttling, and errors — without needing access to a real backend.

A built-in **Coding Assistant**, powered by your choice of AI provider (Anthropic Claude, OpenAI GPT, or Google Gemini), can read, write, and search files in your workspace to help you automate changes like swapping API endpoints, scaffolding loading states, or debugging frontend issues.

## Demo Video

For a visual demonstration of Iodine IDE in action, check out our [YouTube demo](https://youtube.com/watch?v=4uRyc2Wuvy4).

## Screenshots

![Iodine IDE — Editor and Coding Assistant](images/screenshot_1.png)
*Figure 1: Iodine IDE showcasing the main editor interface along with the AI-powered Coding Assistant in action.*

![Iodine IDE — System View](images/screenshot_2.png)
*Figure 2: System View depicting the interactive architecture graph generation feature.*

## Features

- 🖥️ **VS Code-like IDE shell** — Activity bar, file explorer sidebar, Monaco-powered code editor, and resizable panels
- 📁 **File & folder creation** — Hover any folder in the Explorer to reveal a **+** button; pick **New File** or **New Folder** from the dropdown, type a name (default "Untitled"), and press Enter. Errors out if the name already exists.
- 🤖 **AI Coding Assistant** — Streaming chat with tool use (read/write/search files) backed by Claude, GPT, or Gemini
- 🌿 **Source Control panel** — View Git status, stage/unstage files, discard changes, and commit — all from the UI
- 📂 **File preview** — Render `.md` (with GitHub Flavored Markdown) and `.html` files inline
- 🔌 **Simulation panel** — Placeholder for planned network mocking and throttling features
- 💾 **Workspace persistence** — The last opened folder is remembered across server restarts; use **File → Close Project** to clear it and return to the clean-slate welcome screen
- 🖥️ **Integrated terminal** — A resizable bottom tray with a real pseudo-terminal (xterm.js + node-pty) running your shell at the workspace root. Open multiple sessions with **+**, close any with **✕**.
- 🌐 **System View** — Interactive SVG graph editor for system architecture diagrams. Hit **⚡ Generate** and the AI explores your workspace with file tools, reads key files, and builds a graph from what it actually finds — no prompt needed. Nodes are draggable; pan and zoom with mouse. Diagram data is auto-saved to `~/.iodine/<workspace-hash>/system-graph.json`.

## System View 📈

Think of System View as "interactive documentation" that stays in-sync with the real code that is on disk.

What you will find on the screen:

| Area | Purpose |
|------|---------|
| Toolbar (top-left) | – **⚡ Generate** &nbsp;Run the AI agent and let it discover components, pages, APIs, databases, queues, etc.<br>– **＋ Node** &nbsp;Add a blank node manually.<br>– **🔗 Link** &nbsp;Draw an edge between two selected nodes.<br>– **🗑️ Delete** &nbsp;Remove selected nodes / edges. |
| Canvas | Interactive SVG/HTML layer powered by D3.  Nodes are draggable, selectable, and have smart snapping for edges.  Mouse-wheel to zoom, right-drag to pan. |
| Inspector (right sidebar) | Edit the selected node: label, kind (UI, API, DB, Cache, Worker, External), colour, and arbitrary key-value metadata (e.g. URL, repo link, tech).  For edges you can choose request type (REST/gRPC/Event) and latency. |
| Mini-map (bottom-right) | Bird’s-eye overview that shows where you are when zoomed in. |

Additional capabilities:

* 🧠 **AI-assisted updates** – After the initial generate you can re-run the agent and it will reconcile manual edits with new discoveries instead of overwriting everything.
* 💾 **Auto-save** – Every change is persisted to `~/.iodine/<workspace-hash>/system-graph.json` so the diagram re-appears exactly as you left it.
* 📤 **Export** – Click the download icon to export the canvas as PNG or SVG for slide decks or wikis.
* 🔒 **Isolated storage** – Because the JSON file lives in your home folder (outside the repo), it will **not** be committed to source control unless you copy it in manually. This keeps private architecture details out of pull requests by default.

> The goal is to remove the drift between architecture docs and reality.  Your diagram is always only one click away from reflecting the true state of the repository.

## Use Cases

* **User experience studies** — Simulate sluggish or unreliable APIs to observe how your UI behaves
* **Frontend optimization** — Profile and improve loading performance under controlled conditions
* **Loading screen development** — Build and tune spinners, skeletons, and progress indicators with realistic delays
* **Error handling / Unhappy paths** — Test 500s, timeouts, and other failure modes without touching the real backend

## How It Works

1. Open a local project folder via **File → Open Project** (searches `~` up to 3 levels deep by folder name) or the sidebar **Open Folder** button (accepts any absolute path).
2. The AI agent reads your source code and can automatically swap API endpoints to point to `localhost`.
3. A lightweight local Express server mocks delays, throttling, errors, and other backend behaviors.
4. Switch to the **System View** tab and click **⚡ Generate** — the AI reads your actual files and builds an interactive architecture graph.
5. Developers can create **checkpoints** to save and restore the local simulation environment.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Code editor | Monaco Editor (`@monaco-editor/react`) |
| Terminal | xterm.js (`@xterm/xterm` + `@xterm/addon-fit`), node-pty |
| Markdown preview | `react-markdown` + `remark-gfm` |
| AI providers | Anthropic Claude, OpenAI GPT, Google Gemini |
| Backend | Node.js, Express 4, TypeScript, `ws` (WebSocket) |
| Dev runner | `tsx watch` (server), Vite HMR (client) |
| Monorepo | npm workspaces + `concurrently` |

## Project Structure

```
iodine/
├── package.json              # Root: npm workspaces + concurrently dev script
├── tsconfig.base.json        # Shared TypeScript config
│
├── client/                   # React + TypeScript frontend (Vite) — http://localhost:5173
│   └── src/
│       ├── App.tsx           # Renders WorkbenchLayout
│       ├── providers.ts      # AI provider + model definitions
│       ├── types/            # Shared types: FileNode, OpenFile, UIMessage, etc.
│       ├── api/              # Typed fetch wrappers for file/workspace endpoints
│       ├── hooks/            # useFileTree, useOpenFiles, useGitStatus, useCodingAssistant, …
│       └── components/
│           ├── layout/       # WorkbenchLayout, MenuBar, ActivityBar, Sidebar, EditorArea, RightPanel
│           ├── sidebar/      # FileExplorer, FileTreeNode, SourceControlPanel
│           ├── editor/       # EditorTabs, MonacoEditor, WelcomeScreen
│           ├── bottom/       # BottomTray, TerminalPanel, TerminalSession (xterm.js)
│           └── right/        # SimulationPanel, CodingAssistant, SystemView
│
└── server/                   # Node.js + Express backend — http://localhost:3001
    └── src/
        ├── app.ts            # Express app factory (CORS, JSON, routes)
        ├── state.ts          # Shared mutable state: rootPath (persisted to ~/.iodine/workspace)
        ├── terminal.ts       # WebSocket terminal manager — node-pty sessions on ws://localhost:3001/terminal
        ├── routes/
        │   ├── files.ts      # File system + workspace + git endpoints
        │   └── agent.ts      # POST /api/agent/chat, POST /api/system-graph/generate (SSE), GET /api/agent/status
        └── services/
            ├── fileSystem.ts     # Pure FS operations + path traversal guard
            ├── fileTools.ts      # Shared tool schemas + executeTool() for all agents
            ├── anthropicAgent.ts # Agentic loop using @anthropic-ai/sdk
            ├── openaiAgent.ts    # Agentic loop using openai SDK
            └── geminiAgent.ts    # Agentic loop using @google/genai SDK
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- At least one AI provider API key (see [Coding Assistant](#coding-assistant) below)

### Installation & Running

```bash
# Install all dependencies (client + server)
npm install

# Start both client and server in development mode
npm run dev
```

- **Client** (React + Vite): http://localhost:5173
- **Server** (Express): http://localhost:3001

Once running, open a project via **File → Open Project** in the menu bar or click **Open Folder** in the left sidebar.

> **Note — Open Project search scope:** The browser's directory picker only gives the app the folder *name*, not the full path. The server resolves the name by searching your home directory up to **3 levels deep** (i.e. `~/name`, `~/*/name`, `~/*/*/name`). If your project lives outside your home directory, or is nested more than 3 levels deep, use the sidebar **Open Folder** button and type the absolute path directly.

### Other Scripts

```bash
npm run build      # Build both client and server for production
npm run typecheck  # Run TypeScript type checks across the monorepo
```

## Coding Assistant

The Coding Assistant (right panel) supports three AI providers. Select a provider and model from the dropdowns, then chat naturally. The AI can read, write, and search files in your workspace autonomously.

### Supported Providers & API Keys

| Provider | API Key Location | Models |
|----------|-----------------|--------|
| **Anthropic** | `~/.anthropic/api_key` or `ANTHROPIC_API_KEY` env var | Claude Sonnet 4.6 / 4.5 / 3.7 |
| **OpenAI** | `OPENAI_TOKEN` env var | GPT-4o, GPT-4o mini, o3, o4-mini |
| **Google** | `GEMINI_API_KEY` env var | Gemini 2.5 Flash / Pro, 2.0 Flash |

> If Claude Code is installed, its Anthropic key is reused automatically.

The UI shows a warning banner when the selected provider's key is not configured. Click **?** in the panel header for setup instructions.

### AI File Tools

All three providers share the same tool layer and can perform:

| Tool | Description |
|------|-------------|
| `read_file` | Read a file from the workspace |
| `write_file` | Write (or create) a file in the workspace |
| `list_directory` | Browse the directory tree (depth 3) |
| `search_files` | Grep-like text search across workspace files |

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/workspace/open` | Set workspace root `{ path }` |
| `POST` | `/api/workspace/close` | Clear workspace root and delete persisted path |
| `GET` | `/api/workspace` | Get current workspace root |
| `POST` | `/api/workspace/find` | Search for a directory by name `{ name }` — scans `~/name`, `~/*/name`, `~/*/*/name` (skips `node_modules`, `.git`, etc.) |
| `GET` | `/api/files/tree` | Full directory tree from workspace root |
| `GET` | `/api/files/content?path=` | Read a file's text content |
| `PUT` | `/api/files/content` | Write a file `{ path, content }` |
| `GET` | `/api/git/status` | Git status badges for the file tree |
| `GET` | `/api/git/diff?path=` | Unified diff for editor decorations |
| `GET` | `/api/git/changes` | Full staged/unstaged change list for SCM panel |
| `POST` | `/api/git/stage` | Stage a file `{ relPath }` |
| `POST` | `/api/git/unstage` | Unstage a file `{ relPath }` |
| `POST` | `/api/git/stage-all` | Stage all changes |
| `POST` | `/api/git/discard` | Discard changes `{ relPath, isUntracked }` |
| `POST` | `/api/files/create` | Create a file or directory `{ path, type: 'file'\|'directory' }` — 409 if already exists |
| `POST` | `/api/git/commit` | Commit staged changes `{ message }` |
| `GET` | `/api/agent/status` | Per-provider API key status |
| `POST` | `/api/agent/chat` | SSE stream: AI chat with tool use |
| `GET` | `/api/system-graph` | Load saved architecture graph for current workspace |
| `PUT` | `/api/system-graph` | Save architecture graph for current workspace |
| `POST` | `/api/system-graph/generate` | SSE stream: agentic graph generation (reads workspace) |

## What Do You Plan to Support?

* HTTP/HTTPS endpoint mocking
* gRPC mocking
* LLM API simulation
* Checkpoint save/load for simulation environments
