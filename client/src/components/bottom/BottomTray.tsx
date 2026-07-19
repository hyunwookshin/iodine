import { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { TerminalPanel, TerminalPanelHandle } from './TerminalPanel';

type BottomTab = 'terminal';

interface BottomTrayProps {
  height: number;
  workspacePath: string | null;
}

export interface BottomTrayHandle {
  runCommand: (cmd: string) => void;
}

export const BottomTray = forwardRef<BottomTrayHandle, BottomTrayProps>(
  function BottomTray({ height, workspacePath }, ref) {
    const [activeTab, setActiveTab] = useState<BottomTab>('terminal');
    const terminalPanelRef = useRef<TerminalPanelHandle>(null);

    useImperativeHandle(ref, () => ({
      runCommand: (cmd: string) => {
        setActiveTab('terminal');
        terminalPanelRef.current?.runCommand(cmd);
      },
    }), []);

    return (
      <div
        style={{
          height,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg-panel, #1e1e1e)',
          borderTop: '1px solid var(--color-border)',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {/* Tab strip */}
        <div
          style={{
            height: 35,
            display: 'flex',
            alignItems: 'stretch',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          {([
            { id: 'terminal', label: 'Terminal' },
          ] as { id: BottomTab; label: string }[]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid var(--color-accent, #0e639c)' : '2px solid transparent',
                cursor: 'pointer',
                padding: '0 12px',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: activeTab === tab.id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'terminal' && (
          <TerminalPanel ref={terminalPanelRef} workspacePath={workspacePath} />
        )}
      </div>
    );
  }
);
