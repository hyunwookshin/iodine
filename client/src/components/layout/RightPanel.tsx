import { useState, useRef, useImperativeHandle, forwardRef, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { CodingAssistant } from '../right/CodingAssistant';
import type { CodingAssistantHandle } from '../right/CodingAssistant';
import { SystemView } from '../right/SystemView';
import type { SystemViewHandle } from '../right/SystemView';
import { BuildAssistant } from '../right/BuildAssistant';
import type { Provider } from '../../providers';
import type { FileNode } from '../../types';
import { useSystemGraph } from '../../hooks/useSystemGraph';
import type { SystemGraph } from '../../api/files';

type RightTab = 'assistant' | 'build' | 'system';

export interface RightPanelHandle {
  /** Forward a cursor position to the System View for reverse lookup. */
  lookupByPosition: (absoluteFilePath: string, line: number) => void;
  /** Forward a file/folder path to the System View for reverse lookup (file-explorer click — may switch tab). */
  lookupByPath: (path: string) => void;
  /** Silently sync the active editor file to System View without switching tabs.
   *  Returns the matched node/edge name, or null if no graph / no match. */
  syncActiveFile: (path: string | null) => string | null;
  /** Inject a proactive AI message into the Coding Assistant chat. */
  injectProactiveMessage: (message: string, collectContext: () => Promise<string>) => void;
  /** Start the looping yellow attention pulse on the panel border. */
  triggerPulse: () => void;
  /** Stop the pulse immediately (e.g. user started typing). */
  stopPulse: () => void;
  /** Forward an editor keypress to the Coding Assistant to arm the progress watch. */
  notifyEditorActivity: () => void;
  /** Switch the right panel to the System View tab. */
  openSystemView: () => void;
}

interface RightPanelProps {
  width: number;
  animated?: boolean;
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
  onNavigateToLine?: (filePath: string, line: number, endLine?: number, startCol?: number, endCol?: number) => void;
  onOpenUrl?: (url: string) => void;
  activeSystemNode?: string | null;
  onUserTyping?: () => void;
  onMessageSent?: () => void;
  onAssistantBusyChange?: (busy: boolean) => void;
  onWatchTrigger?: () => void;
  onAssistantReply?: (text: string, hadToolUse: boolean) => void;
  onFileTreeRefresh?: () => void;
  onSummaryRequest?: (filePath: string) => void;
  commitDiffContext?: { shortHash: string; content: string } | null;
  onClearCommitDiffContext?: () => void;
}

export const RightPanel = forwardRef<RightPanelHandle, RightPanelProps>(
function RightPanel({ width, animated, workspacePath, activeFilePath, onWorkspaceOpen, provider, model, setProvider, setModel, getEditorContext, runCommandInTerminal, contextNodes, onRemoveContextNode, onClearContextNodes, onNavigateToLine, onOpenUrl, activeSystemNode, onUserTyping, onMessageSent, onAssistantBusyChange, onWatchTrigger, onAssistantReply, onFileTreeRefresh, onSummaryRequest, commitDiffContext, onClearCommitDiffContext }, ref) {
  const [activeTab, setActiveTab] = useState<RightTab>('assistant');
  const panelRef             = useRef<HTMLDivElement>(null);
  const pulseAutoStopRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const systemViewRef        = useRef<SystemViewHandle>(null);
  const codingAssistantRef   = useRef<CodingAssistantHandle>(null);
  const { graph, setGraph, loaded: graphLoaded, saving: graphSaving, saveError: graphSaveError, save: saveGraph } = useSystemGraph(workspacePath);
  const handleGraphChange = useCallback((nextGraph: SystemGraph) => setGraph(nextGraph), [setGraph]);

  useEffect(() => {
    if (activeTab === 'assistant') {
      codingAssistantRef.current?.focus();
    }
  }, [activeTab]);

  const handleOpenNode = useCallback((_nodeName: string, _nodeId?: string) => {
    // flushSync commits the tab switch synchronously so the SVG has real
    // clientWidth/clientHeight before focusSelected reads them.
    flushSync(() => setActiveTab('system'));
    systemViewRef.current?.focusSelected();
  }, []);

  useImperativeHandle(ref, () => ({
    lookupByPosition: (absoluteFilePath: string, line: number) => {
      const matched = systemViewRef.current?.lookupByPosition(absoluteFilePath, line) ?? false;
      if (matched && activeTab !== 'assistant') setActiveTab('system');
    },
    lookupByPath: (path: string) => {
      if (!systemViewRef.current?.hasGraph()) return;
      if (activeTab === 'system') {
        // Already visible — select + pan with real dimensions.
        systemViewRef.current.lookupByPath(path);
      } else if (activeTab !== 'assistant') {
        // Hidden but will switch — select now, switch tab (flushSync), then pan.
        systemViewRef.current.selectByPath(path);
        flushSync(() => setActiveTab('system'));
        systemViewRef.current.focusSelected();
      } else {
        // On Coding Assistant — just update selection silently, no tab switch.
        systemViewRef.current.selectByPath(path);
      }
    },
    syncActiveFile: (path: string | null) => {
      if (!path || !systemViewRef.current?.hasGraph()) return null;
      if (activeTab === 'system') {
        // Tab is visible — lookupByPath does select + pan with live SVG dimensions.
        return systemViewRef.current.lookupByPath(path);
      }
      // Tab hidden — select only (can't pan; SVG has no rendered dimensions).
      return systemViewRef.current.selectByPath(path);
    },
    injectProactiveMessage: (message, collectContext) => {
      codingAssistantRef.current?.injectProactiveMessage(message, collectContext);
    },
    triggerPulse: () => {
      const el = panelRef.current;
      if (!el) return;
      // Remove, force reflow, re-add — guarantees animation restart even on repeat triggers.
      el.classList.remove('proactive-pulse');
      void el.offsetWidth;
      el.classList.add('proactive-pulse');
      // Auto-stop after 10 seconds if the user hasn't responded.
      if (pulseAutoStopRef.current) clearTimeout(pulseAutoStopRef.current);
      pulseAutoStopRef.current = setTimeout(() => {
        panelRef.current?.classList.remove('proactive-pulse');
      }, 10_000);
    },
    stopPulse: () => {
      if (pulseAutoStopRef.current) clearTimeout(pulseAutoStopRef.current);
      panelRef.current?.classList.remove('proactive-pulse');
    },
    notifyEditorActivity: () => {
      codingAssistantRef.current?.notifyEditorActivity();
    },
    openSystemView: () => {
      setActiveTab('system');
    },
  }), [activeTab]);

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
          padding: '7px 12px',
          borderBottom: '1px solid var(--color-border-callout)',
          borderTop: '1px solid var(--color-border-callout)',
          backgroundColor: 'var(--color-bg-callout)',
          fontSize: 11.5,
          lineHeight: '1.6',
          flexShrink: 0,
        }}
      >
        <div style={{ color: 'var(--color-text-callout)' }}>
          <strong>Provider:</strong> {provider.label}
        </div>
        <div style={{ color: 'var(--color-text-callout)' }}>
          <strong>Model:</strong> {modelLabel}
          {editableNote && <span dangerouslySetInnerHTML={{ __html: editableNote }} />}
        </div>
        {tabId === 'system' && (
          <div style={{ marginTop: 3, color: 'var(--color-text-callout)', opacity: 0.75, fontStyle: 'italic', fontSize: 10.5 }}>
            For best results use Claude Opus+ or GPT 5.5+
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={panelRef}
      style={{
        width,
        background: 'var(--color-bg-right-panel)',
        borderLeft: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
        transition: animated ? 'width 320ms cubic-bezier(0.4, 0, 0.2, 1)' : undefined,
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
          { id: 'system',    label: 'Iogram' },
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
        <SystemView ref={systemViewRef} workspacePath={workspacePath} provider={provider} model={model}
          graph={graph} graphLoaded={graphLoaded} saving={graphSaving} saveError={graphSaveError}
          onGraphChange={handleGraphChange} onSave={saveGraph} onNavigateToLine={onNavigateToLine} />
      </div>

      <div style={{ flex: 1, display: activeTab === 'build' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
        <BuildAssistant workspacePath={workspacePath} provider={provider} model={model} runCommandInTerminal={runCommandInTerminal} onOpenUrl={onOpenUrl} />
      </div>

      <div style={{ flex: 1, display: activeTab === 'assistant' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
        <CodingAssistant ref={codingAssistantRef} workspacePath={workspacePath} activeFilePath={activeFilePath} onWorkspaceOpen={onWorkspaceOpen}
          provider={provider} model={model} setProvider={setProvider} setModel={setModel} getEditorContext={getEditorContext}
          contextNodes={contextNodes} onRemoveContextNode={onRemoveContextNode} onClearContextNodes={onClearContextNodes}
          onNavigateToLine={onNavigateToLine} onOpenNode={handleOpenNode} activeSystemNode={activeSystemNode}
          graph={graph} onOpenIogram={() => setActiveTab('system')}
          onUserTyping={() => { if (pulseAutoStopRef.current) clearTimeout(pulseAutoStopRef.current); panelRef.current?.classList.remove('proactive-pulse'); onUserTyping?.(); }}
          onMessageSent={onMessageSent}
          onAssistantBusyChange={onAssistantBusyChange}
          onWatchTrigger={onWatchTrigger}
          onAssistantReply={onAssistantReply}
          onFileTreeRefresh={onFileTreeRefresh}
          onSummaryRequest={onSummaryRequest}
          commitDiffContext={commitDiffContext}
          onClearCommitDiffContext={onClearCommitDiffContext} />
      </div>
    </div>
  );
});
RightPanel.displayName = 'RightPanel';
