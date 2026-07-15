# Debugging Notes

## SSE Streaming via Vite Dev Proxy

### Symptom

The Coding Assistant would show a blinking cursor (streaming state) indefinitely after
sending a message. The Anthropic API call was never made, and no text appeared.

### Root Cause 1 — `req.on('close')` fires immediately for POST requests

In Node.js/Express, `req` is an `IncomingMessage` (a Readable stream wrapping the TCP
socket). For a POST request, Express's JSON body parser reads the entire request body
upfront. Once the body is consumed, the `req` stream reaches EOF and is destroyed, which
fires the `'close'` event on `req` — even though the TCP connection (and therefore the
SSE response channel) is still open.

We were using `req.on('close', ...)` to detect client disconnection. This caused
`abortSignal.aborted = true` to be set almost immediately (within ~5ms, the time for the
file read in `loadApiKey()`), aborting the agent loop before any Anthropic API call.

**Fix:** Use `res.on('close', ...)` instead. `res` is a `ServerResponse` (a Writable
stream) and its `'close'` event only fires when the response channel is actually
destroyed — i.e., when the client genuinely closes the SSE connection.

```typescript
// WRONG — fires when request body is consumed, not when client disconnects
req.on('close', () => { abortSignal.aborted = true; });

// CORRECT — fires when the response stream is actually closed
res.on('close', () => { abortSignal.aborted = true; });
```

### Root Cause 2 — Vite proxy closes the backend connection prematurely

Even after fixing the `req/res` confusion above, the Vite dev proxy (based on
`http-proxy`) was closing its connection to the Express backend shortly after the first
SSE chunk was forwarded. The browser's SSE stream stayed open (waiting on Vite), but
Express saw `res.on('close')` fire, so no further writes were made.

The exact mechanism is unclear — it may be an `http-proxy` idle-connection behaviour or
an interaction with Firefox extensions. Symptoms:
- Server saw `res close` milliseconds after sending the ping.
- Browser received the ping but then waited indefinitely (cursor blinking).
- Anthropic API call was never started.

**Fix:** The client makes SSE requests directly to `http://localhost:3001` in development,
bypassing the Vite proxy entirely. Express already has CORS configured for
`localhost:5173`, so cross-origin requests work.

```typescript
// useCodingAssistant.ts
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';
const response = await fetch(`${API_BASE}/api/agent/chat`, { ... });
```

Non-streaming endpoints (status checks, file API) continue to go through the Vite proxy
at `/api/*` without issue.

### Diagnostic approach used

1. Added `console.log` at each server stage (route entry, headers flushed, `runAgentLoop`
   start, stream events, final message).
2. Added `console.log` in the client hook for each raw SSE chunk and parsed event.
3. Added a `GET /api/agent/test-sse` endpoint that sends 5 SSE events on a timer with no
   Anthropic call — used to isolate the SSE pipeline from the AI API call.
4. Added an immediate SSE comment (`': ping\n\n'`) after `flushHeaders()` to verify that
   at least one byte reaches the browser before the connection closes.

These four data points together pinpointed that:
- The ping reached the browser (pipeline works for one chunk).
- The server saw disconnect before the Anthropic call (not an API issue).
- `req.on('close')` was the false-positive disconnect trigger.
- The Vite proxy was separately closing the backend connection.

---

## Workspace State Lost on Server Restart

### Symptom

After successfully opening a workspace and verifying it worked, the Coding Assistant would
show "No workspace open" after a server restart. The left sidebar also lost its file tree.
`tsx watch` restarts the server automatically when any server-side file is edited.

### Root Cause

`rootPath` is a module-level `export let` variable in `server/src/state.ts`. When
`tsx watch` detects a file change and restarts the Node process, all in-memory state
resets. The React client still held the old `workspacePath` in its own state, creating a
split-brain situation: client thought workspace was set, server did not.

Suspicion initially fell on ESM live-binding semantics (does `import { rootPath }` in
another module see the updated value after `setRootPath()` is called?). This was tested
and confirmed to work correctly — `tsx` does handle `export let` as a live binding. The
real issue was process restart, not live bindings.

### Fix

Persist the workspace path to disk in `server/src/state.ts`:

```typescript
const PERSIST_FILE = path.join(os.homedir(), '.iodine', 'workspace');

function loadPersistedPath(): string | null {
  try {
    const saved = fs.readFileSync(PERSIST_FILE, 'utf-8').trim();
    if (saved && fs.existsSync(saved)) return saved;
  } catch { /* no persisted workspace */ }
  return null;
}

export let rootPath: string | null = loadPersistedPath();

export function setRootPath(p: string) {
  rootPath = p;
  try {
    fs.mkdirSync(path.dirname(PERSIST_FILE), { recursive: true });
    fs.writeFileSync(PERSIST_FILE, p, 'utf-8');
  } catch { /* ignore write errors */ }
}
```

On server startup, the workspace is restored from `~/.iodine/workspace` (if the path
still exists on disk). `WorkbenchLayout` also calls `GET /api/workspace` on mount and
hydrates its `workspacePath` state, so the UI stays in sync after a hot restart.

---

## Coding Assistant "No workspace" Warning Not Updating

### Symptom

Even after setting a workspace via the sidebar or Coding Assistant inline input, the
"No workspace open" warning in the Coding Assistant panel persisted.

### Root Cause

The `CodingAssistant` component was fetching workspace status independently from the
server on mount (`GET /api/agent/status` returned `workspace: rootPath`). This gave a
snapshot at mount time, not a live value. Changes made by other parts of the UI (sidebar
`openWorkspace`, menu bar) did not propagate to the Coding Assistant's local state.

### Fix

Remove the workspace fetch from `CodingAssistant`. Instead, thread `workspacePath` as a
prop from `WorkbenchLayout` → `RightPanel` → `CodingAssistant`. Since `WorkbenchLayout`
owns the single source of truth for `workspacePath`, all panels stay in sync
automatically.

```
WorkbenchLayout (owns workspacePath state)
  └── RightPanel (props: workspacePath, onWorkspaceOpen)
        └── CodingAssistant (props: workspacePath, onWorkspaceOpen)
```

The warning condition is simply `!workspacePath` — no server fetch needed.

---

## Agent Tools Defaulting to Server Working Directory

### Symptom

When no workspace was open, asking the Coding Assistant to list files or search code
would silently list/search the server's working directory (`process.cwd()`, typically the
repo root) instead of returning a clear error.

### Root Cause

The tool implementations in `anthropicAgent.ts` had fallback logic:

```typescript
// list_directory
const dirPath = (input.path as string | undefined) || rootPath || '.';

// search_files
const searchPath = (input.path as string | undefined) || rootPath || process.cwd();
```

Claude would get back results from the wrong location with no indication that the
workspace wasn't set, leading to confusing responses.

### Fix

Remove the fallbacks. Return an explicit error when `rootPath` is null:

```typescript
if (name === 'list_directory') {
  const dirPath = (input.path as string | undefined) || rootPath;
  if (!dirPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
  // ...
}
```

This surfaces the missing-workspace condition clearly to both Claude and the user.

---

## Browser File Picker Cannot Provide Absolute Path

### Symptom

After switching the "Open Project" menu entry to use `<input webkitdirectory>` (OS folder
picker), the server had no way to know the absolute path of the selected folder. The
browser only exposes relative paths like `"myproject/src/index.ts"` via
`file.webkitRelativePath`.

### Root Cause

This is an intentional browser security restriction. The File API and `webkitdirectory`
deliberately withhold the host filesystem path. `showDirectoryPicker()` (File System
Access API) provides the handle but still not the raw absolute path in all environments,
and is not supported in Firefox.

### Fix

Server-side path detection via `POST /api/workspace/find`:

1. Client extracts root folder name from the first `webkitRelativePath` (everything before
   the first `/`).
2. Client sends `POST /api/workspace/find { name: "myproject" }`.
3. Server searches `~/myproject` (direct), then scans all non-hidden subdirectories of `~`
   for `~/*/myproject` (one level deep).
4. If found, returns `{ path: "/absolute/path/to/myproject" }`.
5. Client calls `POST /api/workspace/open` with the resolved path to officially set the
   workspace.
6. If not found, a fallback dialog appears with the folder name pre-filled so the user
   can type the full absolute path.

The one-level-deep scan of `~` (step 3) covers the common convention of grouping projects
under a single directory (e.g. `~/wses/`, `~/code/`, `~/work/`) without requiring the
user to configure anything.

---

## OpenAI Streaming Stutter

### Symptom

When using an OpenAI model the Coding Assistant text would visibly stutter — words
appeared in rapid individual bursts with noticeable jank, whereas Anthropic responses
streamed smoothly.

### Root Cause

OpenAI's chat completions streaming API emits **one token per SSE event**. The previous
SSE reader called `setUiMessages` (a React state setter) for every event, which caused
a full React re-render — including a complete ReactMarkdown re-parse of the growing text
string — for every single token. At 50–80 tokens/s this produced 50–80 renders per
second, each one doing O(n) markdown parsing work that grows with response length.

Anthropic's SDK batches tokens internally before surfacing them through its streaming
iterator, so it naturally emits larger chunks and triggers fewer renders; the problem was
less visible there.

### Fix

Buffer `text_delta` (and `thought_delta`) payloads in React refs instead of updating
state immediately. A single `requestAnimationFrame` is scheduled to drain both buffers
into state — at most once per ~16 ms (~60 fps) regardless of token rate:

```typescript
// useCodingAssistant.ts (hook level)
const textBufRef = useRef('');
const thoughtBufRef = useRef('');
const rafRef = useRef<number | null>(null);

// Inside sendMessage:
const flushBufs = () => {
  rafRef.current = null;
  const txt = textBufRef.current;
  const tht = thoughtBufRef.current;
  textBufRef.current = '';
  thoughtBufRef.current = '';
  if (!txt && !tht) return;
  updateAssistant(msg => {
    const blocks = [...msg.blocks];
    for (const [buf, blockType] of [[tht, 'thought'], [txt, 'text']]) {
      if (!buf) continue;
      const last = blocks[blocks.length - 1];
      if (last?.type === blockType) {
        blocks[blocks.length - 1] = { ...last, content: last.content + buf };
      } else {
        blocks.push({ type: blockType, content: buf });
      }
    }
    return { ...msg, blocks };
  });
};

// text_delta handler:
textBufRef.current += payload.text;
if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushBufs);
```

For a 500-token response streaming at 80 tok/s this reduces React renders from ~500
down to ~30 (capped at 60 fps), eliminating the stutter entirely.

**Ordering safety:** Every structurally significant event (`tool_call`, `tool_result`,
`command_approval`, `done`, `error`) calls `flushNow()` before processing — which cancels
the pending RAF and synchronously drains the buffers — so block ordering in the UI is
always correct even when structural events arrive immediately after text.
