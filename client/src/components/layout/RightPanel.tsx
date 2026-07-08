import { useState } from 'react';
import { SimulationPanel } from '../right/SimulationPanel';
import { CodingAssistant } from '../right/CodingAssistant';

type RightTab = 'simulation' | 'assistant';

interface RightPanelProps {
  width: number;
  workspacePath: string | null;
  onWorkspaceOpen: (path: string) => void;
}

export function RightPanel({ width, workspacePath, onWorkspaceOpen }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<RightTab>('assistant');

  return (
    <div
      style={{
        width,
        background: 'var(--color-bg-right-panel)',
        borderLeft: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
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
          { id: 'simulation', label: 'Simulation' },
          { id: 'assistant', label: 'Coding Assistant' },
        ] as { id: RightTab; label: string }[]).map(tab => (
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
      {activeTab === 'simulation'
        ? <SimulationPanel />
        : <CodingAssistant workspacePath={workspacePath} onWorkspaceOpen={onWorkspaceOpen} />
      }
    </div>
  );
}
