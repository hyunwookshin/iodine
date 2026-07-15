import { useState } from 'react';
import { CodingAssistant } from '../right/CodingAssistant';
import { SystemView } from '../right/SystemView';
import { PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODEL } from '../../providers';
import type { Provider } from '../../providers';

type RightTab = 'assistant' | 'system';

interface RightPanelProps {
  width: number;
  workspacePath: string | null;
  activeFilePath: string | null;
  onWorkspaceOpen: (path: string) => void;
}

export function RightPanel({ width, workspacePath, activeFilePath, onWorkspaceOpen }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<RightTab>('assistant');

  // Provider/model — shared across Coding Assistant and System View
  const [provider, setProviderState] = useState<Provider>(DEFAULT_PROVIDER);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const setProvider = (id: string) => {
    const p = PROVIDERS.find(p => p.id === id) ?? DEFAULT_PROVIDER;
    setProviderState(p);
    setModel(p.models[0].id);
  };

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
          { id: 'assistant', label: 'Coding Assistant' },
          { id: 'system', label: 'System View' },
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
      {activeTab === 'system'
        ? <SystemView workspacePath={workspacePath} provider={provider} model={model} />
        : <CodingAssistant workspacePath={workspacePath} activeFilePath={activeFilePath} onWorkspaceOpen={onWorkspaceOpen}
            provider={provider} model={model} setProvider={setProvider} setModel={setModel} />
      }
    </div>
  );
}
