import type { Server, IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { loadGeminiKey } from './services/geminiAgent';

// Gemini Live WebSocket endpoint (BidiGenerateContent).
const GEMINI_LIVE_URL = (apiKey: string) =>
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

// Track active Gemini relay sockets for cleanup on server shutdown,
// same pattern as activePtys in terminal.ts.
const activeRelays = new Set<WebSocket>();

function closeAllRelays() {
  for (const ws of activeRelays) {
    try { ws.close(); } catch { /* already gone */ }
  }
  activeRelays.clear();
}

process.once('SIGTERM', () => { closeAllRelays(); });
process.once('SIGINT',  () => { closeAllRelays(); });
process.on('exit',      () => { closeAllRelays(); });

export function setupMeetingRelay(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname !== '/meeting/relay') return;
    wss.handleUpgrade(req, socket as never, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (clientWs: WebSocket) => {
    let geminiWs: WebSocket | null = null;

    const closeAll = () => {
      if (geminiWs) { activeRelays.delete(geminiWs); try { geminiWs.close(); } catch { /* gone */ } }
      if (clientWs.readyState === WebSocket.OPEN) try { clientWs.close(); } catch { /* gone */ }
    };

    try {
      const apiKey = await loadGeminiKey();
      geminiWs = new WebSocket(GEMINI_LIVE_URL(apiKey));
      activeRelays.add(geminiWs);

      geminiWs.on('open', () => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'relay-ready' }));
        }
      });

      // Gemini → Client: forward raw frames as-is
      geminiWs.on('message', (data: Buffer) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
      });

      geminiWs.on('close', () => {
        activeRelays.delete(geminiWs!);
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
      });

      geminiWs.on('error', (err) => {
        console.error('[Meeting/Relay] Gemini WS error:', err.message);
        closeAll();
      });

      // Client → Gemini: forward as text (client sends JSON strings)
      clientWs.on('message', (data: Buffer, isBinary: boolean) => {
        if (geminiWs?.readyState === WebSocket.OPEN) {
          geminiWs.send(isBinary ? data : data.toString());
        }
      });

      clientWs.on('close', () => {
        activeRelays.delete(geminiWs!);
        if (geminiWs?.readyState === WebSocket.OPEN) try { geminiWs.close(); } catch { /* gone */ }
      });

      clientWs.on('error', (err) => {
        console.error('[Meeting/Relay] Client WS error:', err.message);
        closeAll();
      });

    } catch (err) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
        clientWs.close();
      }
    }
  });
}
