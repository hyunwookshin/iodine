# Google Gemini Integration

Iodine's Coding Assistant supports Google Gemini models alongside Anthropic Claude and OpenAI.

## Setup

Set your Google AI API key in the environment before starting the server:

```bash
export GEMINI_API_KEY=AIza...
```

Restart the dev server after setting the variable.

## Available Models

| Model ID | Label |
|---|---|
| `gemini-2.5-flash` | Gemini 2.5 Flash |
| `gemini-2.5-pro` | Gemini 2.5 Pro |
| `gemini-2.0-flash` | Gemini 2.0 Flash |

## How It Works

### Server-side (`server/src/services/geminiAgent.ts`)

Uses the `@google/genai` SDK (`GoogleGenAI` class) with streaming:

```
ai.models.generateContentStream({ model, contents, config: { systemInstruction, tools } })
```

The agent runs the same agentic loop as the Anthropic and OpenAI agents:

1. Stream response chunks — forward `text` deltas to the client via SSE
2. Accumulate `functionCalls` from chunks
3. Emit `tool_call` SSE events, execute tools via the shared `executeTool()` in `fileTools.ts`
4. Emit `tool_result` SSE events, append function responses as a `user` turn
5. Loop until the model returns no function calls, then emit `done`

Conversation history uses Gemini's role names (`user` / `model`); incoming `assistant` messages are translated to `model` on the way in.

### Shared Tool Layer

All three providers (Anthropic, OpenAI, Google) share the same file tools defined in
`server/src/services/fileTools.ts`:

| Tool | Description |
|---|---|
| `read_file` | Read a file from the workspace |
| `write_file` | Write content to a file |
| `list_directory` | List the workspace directory tree (depth 3) |
| `search_files` | Grep-like text search across workspace files |

Tool schemas are stored as JSON Schema in `TOOL_SCHEMAS` and converted to each provider's
native format in the respective agent service.

### Client-side

The Google provider entry lives in `client/src/providers.ts`. Adding it there was the only
client-side change required — the UI (provider dropdown, model selector, help popover, and
API key warning) all derive from the `PROVIDERS` array automatically.

## API Key Status

`GET /api/agent/status` returns per-provider key status:

```json
{ "providers": { "anthropic": true, "openai": false, "google": true } }
```

The Coding Assistant panel shows a warning banner for the currently selected provider
if its key is not configured.
