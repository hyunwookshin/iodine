import type { Server, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import os from 'os';
import { existsSync } from 'fs';
import { rootPath } from './state';

export function setupTerminalWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname !== '/terminal') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket as never, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url!, 'http://localhost');
    const cwdParam = url.searchParams.get('cwd');
    const cmdParam = url.searchParams.get('cmd');

    // Prefer explicit cwd param; fall back to server's current workspace root or home.
    // Validate each candidate exists so node-pty doesn't fail with posix_spawnp.
    const cwdCandidates = [cwdParam, rootPath, os.homedir()].filter(Boolean) as string[];
    const cwd = cwdCandidates.find(c => existsSync(c)) ?? os.homedir();
    
    // Determine shell with fallback chain
    let shell = process.env.SHELL || '/bin/bash';
    
    // Verify shell exists; if not, try common alternatives
    if (!existsSync(shell)) {
      const shellOptions = ['/bin/zsh', '/bin/bash', '/bin/sh'];
      shell = shellOptions.find(sh => existsSync(sh)) || '/bin/bash';
    }
    
    const args = cmdParam ? ['-c', cmdParam] : [];

    let ptyProc: ReturnType<typeof pty.spawn>;
    try {
      ptyProc = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('Terminal spawn error:', errorMsg);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
          type: 'output', 
          data: `\r\nFailed to start terminal: ${errorMsg}\r\nShell: ${shell}\r\nCwd: ${cwd}\r\n` 
        }));
        ws.close();
      }
      return;
    }

    ptyProc.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    ptyProc.onExit(({ exitCode }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
        ws.close();
      }
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; data?: string; cols?: number; rows?: number };
        if (msg.type === 'input' && typeof msg.data === 'string') {
          ptyProc.write(msg.data);
        } else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          ptyProc.resize(msg.cols, msg.rows);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      try { ptyProc.kill(); } catch { /* already exited */ }
    });
  });
}
