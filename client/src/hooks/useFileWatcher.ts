import { useEffect, useRef } from 'react';

// Bypass the Vite proxy for SSE — same reason as useCodingAssistant (proxy drops the connection).
const WATCH_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

/**
 * Opens a persistent SSE connection to /api/files/watch and calls
 * onFileChanged(absPath) whenever the server detects a file modification.
 *
 * The EventSource reconnects automatically on network errors.
 * The connection is torn down when workspacePath changes or the component unmounts.
 */
export function useFileWatcher(
  workspacePath: string | null,
  onFileChanged: (absPath: string) => void,
) {
  // Keep the callback ref-stable so the EventSource doesn't need to be recreated
  // every time the parent re-renders.
  const callbackRef = useRef(onFileChanged);
  callbackRef.current = onFileChanged;

  useEffect(() => {
    if (!workspacePath) return;

    const es = new EventSource(`${WATCH_BASE}/api/files/watch`);

    es.addEventListener('file-changed', (e: MessageEvent) => {
      try {
        const { path } = JSON.parse(e.data as string) as { path: string };
        callbackRef.current(path);
      } catch { /* ignore malformed events */ }
    });

    return () => es.close();
  }, [workspacePath]);
}
