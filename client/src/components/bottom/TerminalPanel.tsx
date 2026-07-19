import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { TerminalSession } from './TerminalSession';

interface Session {
  id: number;
  wsUrl: string;
  label: string;
  dead: boolean;
}

interface TerminalPanelProps {
  workspacePath: string | null;
}

export interface TerminalPanelHandle {
  runCommand: (cmd: string) => void;
}

let nextId = 1;

function buildWsUrl(workspacePath: string | null, cmd?: string): string {
  const params = new URLSearchParams();
  if (workspacePath) params.set('cwd', workspacePath);
  if (cmd) params.set('cmd', cmd);
  return `ws://localhost:3001/terminal?${params}`;
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(
  function TerminalPanel({ workspacePath }, ref) {
    const workspaceRef = useRef(workspacePath);
    workspaceRef.current = workspacePath;

    const [sessions, setSessions] = useState<Session[]>(() => {
      const id = nextId++;
      return [{ id, wsUrl: buildWsUrl(workspacePath), label: 'bash', dead: false }];
    });
    const [activeId, setActiveId] = useState<number>(() => sessions[0].id);
    const activeIdRef = useRef(activeId);
    activeIdRef.current = activeId;

    const addSession = useCallback((cmd?: string) => {
      const id = nextId++;
      const label = cmd ? cmd.split(' ')[0] : 'bash';
      setSessions(prev => [...prev, { id, wsUrl: buildWsUrl(workspaceRef.current, cmd), label, dead: false }]);
      setActiveId(id);
    }, []);

    useImperativeHandle(ref, () => ({
      runCommand: (cmd: string) => addSession(cmd),
    }), [addSession]);

    const closeSession = useCallback((id: number) => {
      const confirmed = window.confirm('Close this terminal? The running process will be terminated.');
      if (!confirmed) return;

      setSessions(prev => {
        const idx = prev.findIndex(s => s.id === id);
        const next = prev.filter(s => s.id !== id);

        if (next.length === 0) {
          const newId = nextId++;
          setActiveId(newId);
          return [{ id: newId, wsUrl: buildWsUrl(workspaceRef.current), label: 'bash', dead: false }];
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
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--color-bg-editor)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 28,
            background: 'var(--color-bg-tab-inactive)',
            borderBottom: '1px solid var(--color-border)',
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
                background: activeId === s.id ? 'var(--color-bg-tab-active)' : 'transparent',
                color: s.dead ? 'var(--color-text-secondary)' : activeId === s.id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                borderRight: '1px solid var(--color-border)',
                flexShrink: 0,
                userSelect: 'none',
                fontStyle: s.dead ? 'italic' : 'normal',
              }}
            >
              <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.dead ? 'exited' : s.label}
              </span>
              <span
                onClick={e => { e.stopPropagation(); closeSession(s.id); }}
                title="Close terminal"
                style={{ fontSize: 10, color: 'var(--color-icon)', cursor: 'pointer', lineHeight: 1, padding: '1px 2px' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#ff6b6b'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-icon)'; }}
              >
                ✕
              </span>
            </div>
          ))}

          <button
            onClick={() => addSession()}
            title="New terminal session"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-icon)',
              fontSize: 18,
              lineHeight: 1,
              padding: '0 10px',
              height: '100%',
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-icon-active)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-icon)'; }}
          >
            +
          </button>
        </div>

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
);
