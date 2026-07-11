import { useState, useCallback, useRef } from 'react';
import { TerminalSession } from './TerminalSession';

interface Session {
  id: number;
  wsUrl: string;
  dead: boolean;
}

interface TerminalPanelProps {
  workspacePath: string | null;
}

let nextId = 1;

function buildWsUrl(workspacePath: string | null): string {
  const params = new URLSearchParams();
  if (workspacePath) params.set('cwd', workspacePath);
  return `ws://localhost:3001/terminal?${params}`;
}

export function TerminalPanel({ workspacePath }: TerminalPanelProps) {
  const workspaceRef = useRef(workspacePath);
  workspaceRef.current = workspacePath;

  const [sessions, setSessions] = useState<Session[]>(() => {
    const id = nextId++;
    return [{ id, wsUrl: buildWsUrl(workspacePath), dead: false }];
  });
  const [activeId, setActiveId] = useState<number>(() => sessions[0].id);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const addSession = useCallback(() => {
    const id = nextId++;
    setSessions(prev => [...prev, { id, wsUrl: buildWsUrl(workspaceRef.current), dead: false }]);
    setActiveId(id);
  }, []);

  const closeSession = useCallback((id: number) => {
    const confirmed = window.confirm('Close this terminal? The running process will be terminated.');
    if (!confirmed) return;

    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const next = prev.filter(s => s.id !== id);

      if (next.length === 0) {
        // Auto-open a fresh session when the last one is closed
        const newId = nextId++;
        setActiveId(newId);
        return [{ id: newId, wsUrl: buildWsUrl(workspaceRef.current), dead: false }];
      }

      if (activeIdRef.current === id) {
        const fallback = next[Math.max(0, idx - 1)]?.id ?? next[0].id;
        setActiveId(fallback);
      }

      return next;
    });
  }, []);

  const markDead = useCallback((id: number) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, dead: true } : s));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#1e1e1e' }}>
      {/* Session sub-tab strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 28,
          background: '#252526',
          borderBottom: '1px solid #3c3c3c',
          flexShrink: 0,
          overflowX: 'auto',
        }}
      >
        {sessions.map(s => (
          <div
            key={s.id}
            onClick={() => setActiveId(s.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px',
              height: '100%',
              cursor: 'pointer',
              fontSize: 11,
              background: activeId === s.id ? '#1e1e1e' : 'transparent',
              color: s.dead ? '#555' : activeId === s.id ? '#cccccc' : '#888',
              borderRight: '1px solid #3c3c3c',
              flexShrink: 0,
              userSelect: 'none',
              fontStyle: s.dead ? 'italic' : 'normal',
            }}
          >
            <span>{s.dead ? 'exited' : 'bash'}</span>
            <span
              onClick={e => { e.stopPropagation(); closeSession(s.id); }}
              title="Close terminal"
              style={{ fontSize: 10, color: '#555', cursor: 'pointer', lineHeight: 1, padding: '1px 2px' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff6b6b'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555'; }}
            >
              ✕
            </span>
          </div>
        ))}

        {/* New session button */}
        <button
          onClick={addSession}
          title="New terminal session"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#777',
            fontSize: 18,
            lineHeight: 1,
            padding: '0 10px',
            height: '100%',
            flexShrink: 0,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#cccccc'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#777'; }}
        >
          +
        </button>
      </div>

      {/* All sessions mounted; only the active one is visible to preserve state */}
      {sessions.map(s => (
        <div
          key={s.id}
          style={{ display: s.id === activeId ? 'flex' : 'none', flex: 1, minHeight: 0 }}
        >
          <TerminalSession
            wsUrl={s.wsUrl}
            active={s.id === activeId}
            onExit={() => markDead(s.id)}
          />
        </div>
      ))}
    </div>
  );
}
