<p align="center">
  <img src="images/iodine_logo_2-preview.png" alt="Iodine" width="180" />
</p>

<h1 align="center">Iodine — AI Codebase Harness & Mentor</h1>

<p align="center">
  A developer harness designed like a patient senior engineer beside you—helping you understand unfamiliar code, guiding your next step, and explaining changes as you make them.
</p>

> “Half of [developers] believe a 90% AI-written code scenario.”
> — [Thomas Dohmke, GitHub CEO](https://ashtom.github.io/developers-reinvented)
>
> **Iodine helps you understand that AI-generated code.**

## A mentor for unfamiliar code

Opening a new open source repository can feel like arriving in a city without a map. Iodine provides an execution and mentoring harness that helps you find your way through the codebase without taking control away from you.

It reads the project in context, explains how the pieces fit together, and guides you from your first question to your first confident contribution. Instead of only generating code, Iodine serves as an interactive harness that equips both you and the AI to explore, inspect, and safely modify the codebase.

## Mentor Mode

**Open a repository. Turn on Mentor. Follow the project one file at a time.**

Mentor Mode is Iodine's central experience. It creates a guided walkthrough, opens the relevant file, highlights the lines worth studying, and explains what you are seeing before waiting for you to continue. Every explanation is grounded in the actual project—from architecture diagrams to source code.

<img src="https://github.com/user-attachments/assets/55a721c6-8990-407f-a343-bdecbdf42b1e" alt="Iodine harness demo" width="100%" />

<p align="center">
  More demos on YouTube: <a href="https://youtu.be/QgfjxkFNNDA">Demo 1</a> · <a href="https://youtu.be/DFy1F0CQmN8">Demo 2</a> · <a href="https://youtu.be/gl_IeYgDNJw">Demo 3</a> · <a href="https://www.youtube.com/watch?v=66pxz-CJ_sg">Demo 4</a> · <a href="https://youtu.be/M6C0rk1DwNs">Demo 5</a>
</p>

## How Iodine helps

Iodine supports the way a good human mentor would:

- **Explore** — Follow a guided path through the repository, with relevant files and lines brought into focus.
- **Build Together** — Ask questions, make changes, run tests, and review your work while staying in control.
- **Explain** - Explain the code like no agent could.

The assistant uses the code and context already in your workspace, so guidance stays connected to the project rather than generic examples. It can explain what is happening, suggest a next step, and help you verify the result.

## A developer harness, not just a chat window

Rather than treating the workspace as a traditional IDE or a bare chat prompt, Iodine acts as an agentic harness around your project. It equips the model and developer with the real tools needed for end-to-end work: targeted file inspection and editing, dynamic architecture graphs, integrated terminals, Git diffs, previews, and AI assistance. The harness supports the mentoring and development loop—giving models real execution grounding while keeping you firmly in control.

## System View 📈

System View is interactive documentation generated from the code that is actually on disk.

- **Generate** — The AI explores the workspace and discovers components, pages, APIs, databases, queues, and more.
- **Navigate** — Nodes link back to source locations, and opening a file highlights its matching node.
- **Edit** — Drag, pan, zoom, add, link, delete, and inspect nodes and edges.
- **Reconcile** — Re-run generation to reconcile manual edits with new discoveries.
- **Persist** — Changes are saved to `~/.iodine/<workspace-hash>/system-graph.json` outside the repository by default.
- **Export** — Download the canvas as PNG or SVG for slide decks and wikis.

## Use Cases

- **Understand an unfamiliar codebase** — Learn architecture and implementation one guided step at a time.
- **Agent harness for development** — Provide LLMs and human developers with unified tools: workspace inspection, targeted file edits, live terminals, and Git controls.
- **Learn or teach** — Explore a readable harness architecture integrating Monaco, xterm.js, Git, and multiple AI providers.

## How It Works

1. Open a local project folder via **File → Open Project** or **Open Folder**.
2. Browse and edit files in the Monaco-powered editor with Git status and diffs.
3. Open a file and click **🤖 Summary** for a cached AI-generated tutorial.
4. Use the **Coding Assistant** to ask questions or make changes with workspace tools.
5. Toggle **Tutor** for conversational guidance through the codebase, including help making changes when requested.
6. Use the **Build** tab to generate and execute project-specific commands in a terminal.
7. Open **System View** and click **⚡ Generate** to build an interactive architecture graph.
8. Use the integrated terminal to run commands directly in your workspace.

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

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- At least one AI provider API key — Anthropic, OpenAI, or Google

### Installation & Running

```bash
# Install all dependencies (client + server)
npm install

# Add at least one API key
cp .env.example .env   # then edit it

# Start both client and server in development mode
npm run dev
```

`.env` lives in the project root and is gitignored. Leave the providers you do not use blank. Variables already set in your shell take precedence, so a deployment can supply keys its own way. The **?** button beside the model picker shows the same instructions in the app.

- **Client** (React + Vite): http://localhost:5173
- **Server** (Express): http://localhost:3001

Once running, open a project via **File → Open Project** or click **Open Folder** in the left sidebar.

### Route LLM (optional)

The **Route** toggle in the Coding Assistant (OpenAI only) automatically picks the best model per prompt using [RouteLLM](https://github.com/lm-sys/routellm). It requires a separate Python service:

```bash
# Install Python dependencies (one-time)
pip install routellm fastapi uvicorn tiktoken

# Start the routing service (must run from the models directory)
cd server/src/models && python3.11 -m uvicorn main:app --reload
```

The service runs on http://localhost:8000. If it isn't running, the Coding Assistant falls back to the user-selected model silently. The **Route** toggle is hidden for Anthropic and Google providers.

> **Note — Open Project search scope:** The browser's directory picker only gives the app the folder name, not the full path. The server resolves the name by searching your home directory up to 3 levels deep. If your project lives outside your home directory, or is nested more than 3 levels deep, use **Open Folder** and type the absolute path directly.

### Other Scripts

```bash
npm test           # Run the test suite
npm run build      # Build both client and server for production
npm run typecheck  # Run TypeScript type checks across the monorepo
```

For architecture, extension points, API details, and contributor workflows, see [CONTRIBUTING.md](CONTRIBUTING.md).
