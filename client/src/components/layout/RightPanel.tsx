import { useState } from 'react';
import { CodingAssistant } from '../right/CodingAssistant';
import { SystemView } from '../right/SystemView';
import { BuildAssistant } from '../right/BuildAssistant';
import type { Provider } from '../../providers';
import type { FileNode } from '../../types';

type RightTab = 'assistant' | 'build' | 'system';

interface RightPanelProps {
  width: number;
  workspacePath: string | null;
  activeFilePath: string | null;
  onWorkspaceOpen: (path: string) => void;
  provider: Provider;
  model: string;
  setProvider: (id: string) => void;
  setModel: (id: string) => void;
  getEditorContext?: () => string | null;
  runCommandInTerminal: (cmd: string) => void;
  contextNodes: FileNode[];
  onRemoveContextNode: (path: string) => void;
  onClearContextNodes: () => void;
}

export function RightPanel({ width, workspacePath, activeFilePath, onWorkspaceOpen, provider, model, setProvider, setModel, getEditorContext, runCommandInTerminal, contextNodes, onRemoveContextNode, onClearContextNodes }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<RightTab>('assistant');

  const getModelLabel = (modelId: string): string => {
    for (const p of [provider]) {
      const foundModel = p.models.find(m => m.id === modelId);
      if (foundModel) return foundModel.label;
    }
    return modelId;
  };

  const modelLabel = getModelLabel(model);

  const renderModelInfo = (tabId: RightTab) => {
    const isEditable = tabId === 'assistant';
    const editableNote = isEditable ? ' <i style="color: var(--color-text-secondary);">Set in Coding Assistant</i>' : '';
    
    return (
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-bg-secondary, #f3f3f3)',
          fontSize: 12,
          lineHeight: '1.5',
          flexShrink: 0,
        }}
      >
        <div style={{ color: 'var(--color-text-secondary)' }}>
          <strong>Provider:</strong> {provider.label}
        </div>
        <div style={{ color: 'var(--color-text-secondary)' }}>
          <strong>Model:</strong> {modelLabel}
          {editableNote && <span dangerouslySetInnerHTML={{ __html: editableNote }} />}
        </div>
      </div>
    );
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
          { id: 'build',     label: 'Build' },
          { id: 'system',    label: 'System View' },
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
              flex: 1,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Model info section - only show for non-assistant tabs */}
      {activeTab !== 'assistant' && renderModelInfo(activeTab)}

      {/* Tab content - keep all components mounted to preserve state */}
      <div style={{ flex: 1, display: activeTab === 'system' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
        <SystemView workspacePath={workspacePath} provider={provider} model={model} />
      </div>

      <div style={{ flex: 1, display: activeTab === 'build' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
        <BuildAssistant workspacePath={workspacePath} provider={provider} model={model} runCommandInTerminal={runCommandInTerminal} />
      </div>

      <div style={{ flex: 1, display: activeTab === 'assistant' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
        <CodingAssistant workspacePath={workspacePath} activeFilePath={activeFilePath} onWorkspaceOpen={onWorkspaceOpen}
          provider={provider} model={model} setProvider={setProvider} setModel={setModel} getEditorContext={getEditorContext}
          contextNodes={contextNodes} onRemoveContextNode={onRemoveContextNode} onClearContextNodes={onClearContextNodes} />
      </div>
    </div>
  );
}
