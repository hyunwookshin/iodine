import type { Server, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import os from 'os';
import { existsSync } from 'fs';
import { rootPath } from './state';

// Track all active pty processes so we can kill them on server shutdown.
// tsx watch kills the Node process on file changes, which orphans pty children
// and leaks fds. Registering SIGTERM/SIGINT handlers ensures they are cleaned up.
const activePtys = new Set<ReturnType<typeof pty.spawn>>();

function killAllPtys() {
  for (const p of activePtys) {
    try { p.kill('SIGKILL'); } catch { /* already gone */ }
  }
  activePtys.clear();
}

process.once('SIGTERM', () => { killAllPtys(); process.exit(0); });
process.once('SIGINT',  () => { killAllPtys(); process.exit(0); });
process.on('exit',     ()  => { killAllPtys(); });

const MAX_TERMINALS = 20;

/** Attempt to spawn a pty, retrying once after a short delay on failure. */
async function spawnWithRetry(
  shell: string,
  args: string[],
  opts: pty.IPtyForkOptions,
): Promise<ReturnType<typeof pty.spawn>> {
  try {
    return pty.spawn(shell, args, opts);
  } catch {
    // posix_spawnp can fail transiently (EAGAIN) — wait briefly and retry once.
    await new Promise(r => setTimeout(r, 250));
    return pty.spawn(shell, args, opts);
  }
}

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
    // Enforce a cap on simultaneous terminals to avoid resource exhaustion.
    if (activePtys.size >= MAX_TERMINALS) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'output',
          data: `\r\nToo many open terminals (max ${MAX_TERMINALS}). Close an existing tab and try again.\r\n`,
        }));
        ws.close();
      }
      return;
    }

    const url = new URL(req.url!, 'http://localhost');
    const cwdParam = url.searchParams.get('cwd');
    const cmdParam = url.searchParams.get('cmd');

    // Prefer explicit cwd param; fall back to server's current workspace root or home.
    const cwdCandidates = [cwdParam, rootPath, os.homedir()].filter(Boolean) as string[];
    const cwd = cwdCandidates.find(c => existsSync(c)) ?? os.homedir();

    // Determine shell with fallback chain, Windows-aware.
    let shell = process.env.SHELL || '/bin/bash';
    let args: string[];
    if (process.platform === 'win32') {
      // None of the POSIX shells below exist on Windows; use the system shell.
      shell = process.env.ComSpec || 'powershell.exe';
      args = cmdParam ? ['/d', '/s', '/c', cmdParam] : [];
    } else {
      if (!existsSync(shell)) {
        const shellOptions = ['/bin/zsh', '/bin/bash', '/bin/sh'];
        shell = shellOptions.find(sh => existsSync(sh)) || '/bin/bash';
      }
      args = cmdParam ? ['-c', cmdParam] : [];
    }

    // Spawn asynchronously so we can retry on transient failures.
    spawnWithRetry(shell, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    }).then(ptyProc => {
      activePtys.add(ptyProc);

      ptyProc.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data }));
        }
      });

      ptyProc.onExit(({ exitCode }) => {
        activePtys.delete(ptyProc);
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
        activePtys.delete(ptyProc);
        try { ptyProc.kill(); } catch { /* already exited */ }
      });

    }).catch(err => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('Terminal spawn error:', errorMsg);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'output',
          data: `\r\nFailed to start terminal: ${errorMsg}\r\nShell: ${shell}\r\nCwd: ${cwd}\r\n`,
        }));
        ws.close();
      }
    });
  });
}
