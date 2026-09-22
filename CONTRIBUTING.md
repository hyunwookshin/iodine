# Contributing to Iodine

Iodine — AI Codebase Harness & Mentor — is built to be forked and extended. This guide covers the project structure, common extension points, local development, AI features, and API reference.

## Project Structure

```
iodine/
├── package.json              # Root: npm workspaces + concurrently dev script
├── tsconfig.base.json        # Shared TypeScript config
├── .env.example              # Supported environment variables and API keys
│
├── client/                   # React + TypeScript frontend (Vite) — http://localhost:5173
│   └── src/
│       ├── App.tsx           # Renders WorkbenchLayout
│       ├── providers.ts      # AI provider + model definitions
│       ├── types/            # Shared types: FileNode, OpenFile, UIMessage, etc.
│       ├── api/              # Typed fetch wrappers for server endpoints
│       ├── hooks/            # Workspace, Git, terminal, and assistant state
│       ├── services/         # Client-side feature services
│       ├── utils/            # Shared frontend utilities
│       └── components/
│           ├── layout/       # WorkbenchLayout, MenuBar, ActivityBar, Sidebar, EditorArea, RightPanel
│           ├── sidebar/      # File explorer and source-control views
│           ├── editor/       # Tabs, Monaco editor, previews, and welcome UI
│           ├── bottom/       # Bottom tray and terminal sessions
│           └── right/        # CodingAssistant, BuildAssistant, SystemView
│
├── server/                   # Express + WebSocket backend — http://localhost:3001
│   └── src/
│       ├── app.ts            # Express app and route registration
│       ├── index.ts          # HTTP/WebSocket server startup
│       ├── events.ts         # Server event definitions and coordination
│       ├── state.ts          # Persisted workspace state
│       ├── terminal.ts       # node-pty terminal sessions
│       ├── models/           # Server-side data and provider model definitions
│       ├── prompts/          # System and specialized AI prompts
│       ├── routes/           # Workspace, agent, conversation, Git, terminal, and media endpoints
│       └── services/         # AI provider adapters, agent tools, and server services
│
├── images/                   # Logo, screenshots, and demo video
├── README.md                 # Product overview and getting started guide
├── CONTRIBUTING.md           # This document
├── SOURCE_CONTROL.md         # Git integration reference
├── DEBUGGING.md              # Debugging notes and known failure modes
├── CLAUDE.md                 # AI coding guidance for this repository
└── LICENSE                   # Project license
```

## Local Development

### Prerequisites

- Node.js 18+
- npm 9+
- At least one AI provider API key — Anthropic, OpenAI, or Google

### Install and run

```bash
npm install
cp .env.example .env   # add at least one API key
npm run dev
```

`.env` is read from the project root at server startup and is gitignored. Anything already set in your shell wins over the file.

The client runs at `http://localhost:5173`; the server runs at `http://localhost:3001`.

### Useful commands

```bash
npm test
npm run build
npm run typecheck
```

## AI Features

Iodine's AI features are designed to help developers understand and contribute to unfamiliar codebases:

- **Coding Assistant** — A tool-using assistant that can read, search, write, and modify workspace files.
- **Tutor Mode** — A read-only, step-by-step walkthrough that opens files and highlights relevant lines without writing code.
- **AI Summary** — Cached tutorial-style explanations for files and directories.
- **Build Assistant** — Project-aware generation of test, build, and run commands.
- **System View** — Interactive architecture diagrams generated from the source code, with links back to implementation.

Provider and model definitions live in `client/src/providers.ts`; provider adapters and agent tools live under `server/src/services/`.

## Extension Points

### Add a client feature

1. Add or update shared types in `client/src/types/`.
2. Add API wrappers in `client/src/api/` when the feature needs server communication.
3. Put reusable stateful behavior in `client/src/hooks/`.
4. Add UI components under the closest existing `client/src/components/` area.
5. Thread the feature through `WorkbenchLayout` when it needs workspace-level state or coordination.

### Add a server route

1. Create a route module under `server/src/routes/`.
2. Register it in `server/src/app.ts`.
3. Keep workspace-path validation and error handling close to the route boundary.
4. Add or update typed client wrappers for the endpoint.

### Add an AI provider

1. Add provider/model metadata in `client/src/providers.ts`.
2. Implement the provider adapter under `server/src/services/`.
3. Keep tool behavior provider-independent by using the shared agent-tool layer.
4. Update the provider selection UI and documentation.

### Add an agent tool

Agent tools are declared once and exposed to Anthropic, Gemini, and OpenAI automatically. The latest `git_commit_compose` tool is a useful reference implementation.

1. Add the tool's description and JSON parameter schema to `TOOL_SCHEMAS` in `server/src/services/fileTools.ts`. Use a stable `snake_case` name, precise parameter descriptions, and list every mandatory argument in `required`.
2. Implement ordinary workspace/file operations in `executeTool` in the same file. Return a `ToolResult` with `content`, a concise `preview`, and an `error` flag; validate `rootPath`, inputs, and paths before performing work.
3. Implement interactive or client-facing tools in `executeAgentTool` in `server/src/services/agentTools.ts`, before the fallback to `executeTool`. Emit an SSE event with `res.write(...)`, respect `abortSignal.aborted`, and return a normal `ToolResult`. Tools requiring user approval, such as terminal commands, should remain in this layer.
4. Handle any new SSE event in `client/src/hooks/useCodingAssistant.ts`, then connect it to the owning UI state or component. For example, `git_commit_compose` dispatches a browser event that `client/src/hooks/useSourceControl.ts` consumes to populate the commit editor.
5. Add a phrase in `client/src/hooks/useToolNarration.ts` when Tutor Mode should narrate the action. Also decide whether the tool is safe to include in `SKIPPABLE_TOOLS`; mutating or otherwise meaningful actions should generally remain unskippable.
6. Update `server/src/prompts/systemPrompt.ts` when the assistant needs explicit guidance about when or how to use the tool. Update specialized prompts as needed, and document user-facing behavior in the closest reference guide.
7. Run `npm run typecheck` and `npm run build`, then test the tool with each supported provider. For client-facing tools, verify the SSE event reaches the UI and that cancellation or missing input fails safely.

A tool usually touches only `fileTools.ts` when it can execute entirely on the server. Tools that trigger UI behavior commonly also touch `agentTools.ts`, `useCodingAssistant.ts`, the relevant UI hook/component, `useToolNarration.ts`, and the system prompt.

## Design Principles

- Help users understand before asking them to act.
- Keep Tutor Mode read-only and explicit about what it is showing.
- Ground explanations in files and line ranges from the actual workspace.
- Require explicit approval before running shell commands.
- Prefer shared theme variables over hard-coded colors.
- Keep Iodine easy to fork: use straightforward React, Express, and TypeScript rather than opaque framework abstractions.

## API Reference

The main API areas are:

| Area | Route module |
|------|-------------|
| Files and workspace | `server/src/routes/files.ts` |
| Agent chat | `server/src/routes/agent.ts` |
| AI summaries | `server/src/routes/aiSummary.ts` |
| Build configuration | `server/src/routes/buildConfig.ts` |
| Project metadata | `server/src/routes/project.ts` |
| Git integration | `server/src/routes/git.ts` |

For endpoint payloads and implementation details, inspect the route module and its corresponding client API wrapper.

## Pull Requests

Before opening a pull request:

1. Run `npm test`.
2. Run `npm run typecheck`.
3. Run `npm run build`.
4. Explain user-facing behavior and any changes to AI prompts or tool permissions.
5. Include screenshots or a short recording for meaningful UI changes.
6. Keep documentation in sync with the implementation.
