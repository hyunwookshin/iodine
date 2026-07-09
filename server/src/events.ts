import fs from 'fs';
import { Response } from 'express';
import path from 'path';
import { rootPath } from './state';
import { isBinaryExtension } from './services/fileSystem';

export interface SseEvent { event: string; data: unknown; }

const clients = new Set<Response>();
export function addClient(res: Response) {
  clients.add(res);
  res.on('close', () => {
    clients.delete(res);
  });
}

export function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\n` +
                 `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      // silently drop broken pipe
      clients.delete(res);
    }
  }
}

// ── File watching ───────────────────────────────────────────────────────────

const watchers = new Map<string, fs.FSWatcher>();

export function watchFile(filePath: string) {
  // dedupe
  if (watchers.has(filePath)) return;
  // Only watch files inside current workspace root
  if (!rootPath) return;
  const resolved = path.resolve(filePath);
  if (resolved !== rootPath && !resolved.startsWith(rootPath + path.sep)) return;

  try {
    const watcher = fs.watch(resolved, { persistent: false }, async (eventType) => {
      if (eventType !== 'change') return;
      try {
        if (isBinaryExtension(resolved)) return; // ignore binary files
        const content = await fs.promises.readFile(resolved, 'utf-8');
        broadcast('file-changed', { path: resolved, content });
      } catch {
        /* ignore */
      }
    });
    watcher.on('error', () => {
      watchers.delete(resolved);
    });
    watchers.set(resolved, watcher);
  } catch {
    // ignore failures (e.g., unsupported recursive)
  }
}
