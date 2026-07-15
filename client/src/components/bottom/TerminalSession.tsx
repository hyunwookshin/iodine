import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalSessionProps {
  wsUrl: string;
  /** Whether this session is currently visible (used to re-fit after display:none → flex). */
  active: boolean;
  onExit: () => void;
}

function terminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: styles.getPropertyValue('--color-bg-editor').trim(),
    foreground: styles.getPropertyValue('--color-text-primary').trim(),
    cursor: styles.getPropertyValue('--color-text-primary').trim(),
    selectionBackground: styles.getPropertyValue('--color-bg-selected').trim(),
  };
}

export function TerminalSession({ wsUrl, active, onExit }: TerminalSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Mount terminal and open WebSocket once per session
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: terminalTheme(),
      fontSize: 13,
      fontFamily: '"Menlo", "Monaco", "Courier New", monospace',
      cursorBlink: true,
      scrollback: 1000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    try { fitAddon.fit(); } catch { /* container may be hidden on first render */ }

    termRef.current = term;
    fitRef.current = fitAddon;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };

    ws.onopen = () => {
      try { fitAddon.fit(); } catch { /* ignore */ }
      sendResize();
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as { type: string; data?: string };
        if (msg.type === 'output' && msg.data) {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          onExitRef.current();
        }
      } catch { /* ignore malformed */ }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
      sendResize();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [wsUrl]);

  // Update xterm's canvas colors when the document theme changes.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (termRef.current) termRef.current.options.theme = terminalTheme();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // Re-fit when this session becomes visible (switching away then back hides it via display:none)
  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => {
      const term = termRef.current;
      const fit = fitRef.current;
      const ws = wsRef.current;
      if (!term || !fit) return;
      try { fit.fit(); } catch { /* ignore */ }
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    return () => cancelAnimationFrame(id);
  }, [active]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', padding: '0 4px' }}
    />
  );
}
