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
