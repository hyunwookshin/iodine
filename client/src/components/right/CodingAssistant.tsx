import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCodingAssistant } from '../../hooks/useCodingAssistant';
import { openWorkspace } from '../../api/files';
import { UIMessage, UIBlock } from '../../types';
import { PROVIDERS } from '../../providers';
import type { Provider } from '../../providers';

// Go directly to Express for SSE — Vite proxy closes the backend connection prematurely.
// See DEBUGGING.md for details. Non-streaming requests (workspace, status) use relative
// URLs through the Vite proxy as normal.
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

function ToolBlock({ block }: { block: UIBlock & { type: 'tool' } }) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = JSON.stringify(block.input, null, 2);

  return (
    <div
      style={{
        background: 'var(--color-bg-subtle)',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        marginBottom: 4,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 8px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-secondary)',
          fontSize: 11,
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: block.error ? '#f48771' : '#4ec9b0', fontSize: 9 }}>
            {block.pending ? '○' : block.error ? '✕' : '✓'}
          </span>
          <span style={{ fontFamily: 'monospace' }}>{block.name}</span>
          {block.pending && (
            <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
              running…
            </span>
          )}
        </span>
        <span style={{ fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ padding: '0 8px 8px', fontSize: 11, fontFamily: 'monospace' }}>
          <div style={{ color: 'var(--color-text-secondary)', marginBottom: 4 }}>Input:</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--color-text-primary)', fontSize: 10 }}>
            {inputStr}
          </pre>
          {block.result !== undefined && (
            <>
              <div style={{ color: 'var(--color-text-secondary)', marginTop: 6, marginBottom: 4 }}>
                {block.error ? 'Error:' : 'Result:'}
              </div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: block.error ? '#f48771' : 'var(--color-text-primary)', fontSize: 10 }}>
                {block.result}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ThoughtBlock({ block }: { block: UIBlock & { type: 'thought' } }) {
  return (
    <div
      style={{
        background: 'var(--color-bg-subtler)',
        borderLeft: '3px solid #4fc1ff',
        padding: '4px 8px',
        marginBottom: 4,
        fontSize: 12,
        fontStyle: 'italic',
        color: 'var(--color-text-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {block.content}
    </div>
  );
}

function CommandApprovalBlock({
  block,
  onApprove,
  onReject,
}: {
  block: UIBlock & { type: 'command-approval' };
  onApprove: () => void;
  onReject: () => void;
}) {
  const outputRef = useRef<HTMLPreElement>(null);
  const isPending = block.status === 'pending';
  const isApproved = block.status === 'approved';

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [block.output]);

  const borderColor = isPending ? '#e7c54760' : isApproved ? '#4ec9b040' : '#f4877140';
  const statusColor = isPending ? '#e7c547' : isApproved ? '#4ec9b0' : '#f48771';
  const statusBg    = isPending ? '#e7c54720' : isApproved ? '#4ec9b020' : '#f4877120';
  const statusBorder = isPending ? '#e7c54740' : isApproved ? '#4ec9b040' : '#f4877140';

  return (
    <div style={{
      background: 'var(--color-bg-subtle)',
      border: `1px solid ${borderColor}`,
      borderRadius: 6,
      marginBottom: 6,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '5px 10px',
        background: 'var(--color-bg-subtler)',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <span>⚡</span>
          <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>Terminal command</span>
          {block.longRunning && (
            <span style={{ fontSize: 9, background: '#4fc1ff18', border: '1px solid #4fc1ff40', color: '#4fc1ff', borderRadius: 3, padding: '1px 5px' }}>
              long-running
            </span>
          )}
        </span>
        <span style={{ fontSize: 10, color: statusColor, background: statusBg, border: `1px solid ${statusBorder}`, borderRadius: 3, padding: '1px 6px' }}>
          {isPending ? 'waiting for approval' : isApproved ? 'approved' : 'rejected'}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 5 }}>
          {block.reason}
        </div>
        <pre style={{
          margin: '0 0 5px',
          padding: '5px 8px',
          background: 'var(--color-bg-editor)',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          fontSize: 12,
          fontFamily: 'monospace',
          color: 'var(--color-code-text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          $ {block.command}
        </pre>
        {block.cwd && (
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
            in {block.cwd}
          </div>
        )}

        {/* Approve / Reject */}
        {isPending && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              onClick={onApprove}
              style={{ background: '#1e4a1e', border: '1px solid #4ec9b060', borderRadius: 3, color: '#4ec9b0', fontSize: 11, padding: '4px 12px', cursor: 'pointer', fontWeight: 600 }}
            >
              ✓ Approve
            </button>
            <button
              onClick={onReject}
              style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 3, color: 'var(--color-text-secondary)', fontSize: 11, padding: '4px 12px', cursor: 'pointer' }}
            >
              ✕ Reject
            </button>
          </div>
        )}

        {/* Live output */}
        {block.output && (
          <pre
            ref={outputRef}
            style={{
              marginTop: 8,
              padding: '6px 8px',
              background: 'var(--color-bg-code)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              fontSize: 11,
              fontFamily: 'monospace',
              color: 'var(--color-text-primary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            {block.output}
          </pre>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg, isLast, providerLabel, sendApproval }: {
  msg: UIMessage;
  isLast: boolean;
  providerLabel: string;
  sendApproval: (id: string, approved: boolean) => void;
}) {
  if (msg.role === 'user') {
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4, fontWeight: 600 }}>
          You
        </div>
        <div
          style={{
            background: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 13,
            color: 'var(--color-text-primary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  const isStreaming = msg.isStreaming;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4, fontWeight: 600 }}>
        {providerLabel}
      </div>
      <div>
        {msg.blocks.map((block, i) => {
          if (block.type === 'text') {
            const showCursor = isStreaming && isLast && i === msg.blocks.length - 1;
            return (
              <div key={i} className="md-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ className, children, ...props }) {
                      const isBlock = className?.startsWith('language-');
                      return isBlock ? (
                        <pre className="md-pre"><code className={className} {...props}>{children}</code></pre>
                      ) : (
                        <code className="md-code-inline" {...props}>{children}</code>
                      );
                    },
                  }}
                >
                  {block.content}
                </ReactMarkdown>
                {showCursor && (
                  <span style={{ animation: 'blink 1s step-end infinite', opacity: 1 }}>▌</span>
                )}
              </div>
            );
          }
          if (block.type === 'thought') {
            return <ThoughtBlock key={i} block={block} />;
          }
          if (block.type === 'command-approval') {
            return (
              <CommandApprovalBlock
                key={block.id}
                block={block}
                onApprove={() => sendApproval(block.id, true)}
                onReject={() => sendApproval(block.id, false)}
              />
            );
          }
          return <ToolBlock key={block.id} block={block} />;
        })}
        {isStreaming && msg.blocks.length === 0 && (
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', animation: 'blink 1s step-end infinite' }}>▌</span>
        )}
      </div>
    </div>
  );
}

interface CodingAssistantProps {
  workspacePath: string | null;
  activeFilePath: string | null;
  onWorkspaceOpen: (path: string) => void;
  provider: Provider;
  model: string;
  setProvider: (id: string) => void;
  setModel: (id: string) => void;
  getEditorContext?: () => string | null;
}

export function CodingAssistant({ workspacePath, activeFilePath, onWorkspaceOpen, provider, model, setProvider, setModel, getEditorContext }: CodingAssistantProps) {
  const { uiMessages, isLoading, sendMessage, stopExecution, clearMessages, sendApproval } = useCodingAssistant(provider, model);
  const [input, setInput] = useState('');
  const [providerStatus, setProviderStatus] = useState<Record<string, boolean>>({});
  const [showHelp, setShowHelp] = useState(false);
  const apiConfigured = providerStatus[provider.id] ?? null;
  const [wsInput, setWsInput] = useState('');
  const [wsOpening, setWsOpening] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch API key status on mount; result is a per-provider map
  useEffect(() => {
    fetch(`${API_BASE}/api/agent/status`, { method: 'GET' })
      .then(r => r.json())
      .then(data => setProviderStatus(data.providers ?? { anthropic: data.configured }))
      .catch(() => setProviderStatus({}));
  }, []);

  // Set workspace via the inline input — updates server state and notifies the parent
  const handleSetWorkspace = async () => {
    if (!wsInput.trim()) return;
    setWsOpening(true);
    setWsError(null);
    try {
      const result = await openWorkspace(wsInput.trim());
      if (result.path) {
        onWorkspaceOpen(result.path);
        setWsInput('');
      }
    } catch (err) {
      setWsError(err instanceof Error ? err.message : 'Failed to open folder');
    } finally {
      setWsOpening(false);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [uiMessages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    const editorContext = getEditorContext?.() ?? null;
    sendMessage(text, activeFilePath, editorContext);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .md-body { font-size: 13px; color: var(--color-text-primary); line-height: 1.6; word-break: break-word; margin-bottom: 4px; }
        .md-body > *:first-child { margin-top: 0; }
        .md-body > *:last-child { margin-bottom: 0; }
        .md-body h1, .md-body h2, .md-body h3, .md-body h4 { font-weight: 600; margin: 10px 0 4px; }
        .md-body h1 { font-size: 16px; }
        .md-body h2 { font-size: 14px; }
        .md-body h3, .md-body h4 { font-size: 13px; }
        .md-body p { margin: 4px 0; }
        .md-body ul, .md-body ol { margin: 4px 0; padding-left: 18px; }
        .md-body li { margin: 2px 0; }
        .md-body strong { font-weight: 600; }
        .md-body em { font-style: italic; }
        .md-body blockquote { border-left: 3px solid var(--color-border); margin: 6px 0; padding: 2px 10px; color: var(--color-text-secondary); }
        .md-body hr { border: none; border-top: 1px solid var(--color-border); margin: 8px 0; }
        .md-body a { color: #4fc1ff; text-decoration: underline; }
        .md-body table { border-collapse: collapse; font-size: 12px; margin: 6px 0; width: 100%; }
        .md-body th, .md-body td { border: 1px solid var(--color-border); padding: 4px 8px; text-align: left; }
        .md-body th { background: #ffffff0a; font-weight: 600; }
        .md-pre { background: var(--color-bg-editor); border: 1px solid var(--color-border); border-radius: 4px; padding: 8px 10px; overflow-x: auto; margin: 6px 0; font-size: 12px; font-family: monospace; white-space: pre; }
        .md-code-inline { background: #ffffff12; border-radius: 3px; padding: 1px 4px; font-size: 12px; font-family: monospace; }
      `}</style>

      {/* Model / provider bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          borderBottom: showHelp ? 'none' : '1px solid var(--color-border)',
          flexShrink: 0,
          gap: 6,
          height: 36,
        }}
      >
        {/* Provider selector — single entry now, becomes a dropdown when more providers are added */}
        {PROVIDERS.length === 1 ? (
          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', flexShrink: 0 }}>
            {provider.label}
          </span>
        ) : (
          <select
            value={provider.id}
            onChange={e => setProvider(e.target.value)}
            style={{ background: 'var(--color-bg-sidebar)', border: '1px solid var(--color-border)', borderRadius: 3, color: 'var(--color-text-primary)', fontSize: 11, padding: '2px 4px', cursor: 'pointer' }}
          >
            {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>) }
          </select>
        )}

        {/* Model selector */}
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            background: 'var(--color-bg-sidebar)',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            color: 'var(--color-text-primary)',
            fontSize: 11,
            padding: '2px 4px',
            cursor: 'pointer',
          }}
        >
          {provider.models.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>

        {/* Help button */}
        <button
          onClick={() => setShowHelp(v => !v)}
          title="API key setup"
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: '1px solid var(--color-border)',
            background: showHelp ? 'var(--color-bg-hover)' : 'none',
            color: 'var(--color-text-secondary)',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          ?
        </button>

        {/* Clear chat */}
        {uiMessages.length > 0 && (
          <button
            onClick={clearMessages}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 10, padding: '2px 4px', flexShrink: 0 }}
            title="Clear chat"
          >
            ✕
          </button>
        )}
      </div>

      {/* Help popover */}
      {showHelp && (
        <div
          style={{
            margin: '0 0 0 0',
            padding: '10px 12px',
            background: 'var(--color-bg-subtle)',
            borderBottom: '1px solid var(--color-border)',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>
            {provider.setupTitle}
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.6 }}>
            {provider.setupInstructions}
          </pre>
        </div>
      )}

      {/* API not configured warning */}
      {apiConfigured === false && (
        <div
          style={{
            margin: '8px 8px 0',
            padding: '8px 10px',
            background: '#f487710a',
            border: '1px solid #f4877140',
            borderRadius: 4,
            fontSize: 12,
            color: '#f48771',
            flexShrink: 0,
          }}
        >
          No {provider.label} API key configured. Click <strong>?</strong> above for setup instructions.
        </div>
      )}

      {/* Workspace not configured — file tools won't work */}
      {apiConfigured === true && !workspacePath && (
        <div
          style={{
            margin: '8px 8px 0',
            padding: '8px 10px',
            background: '#e7c5470a',
            border: '1px solid #e7c54740',
            borderRadius: 4,
            fontSize: 12,
            color: '#e7c547',
            flexShrink: 0,
          }}
        >
          <div style={{ marginBottom: 6 }}>
            No workspace set. Enter an absolute path so the assistant can read and write files.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={wsInput}
              onChange={e => setWsInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSetWorkspace(); }}
              placeholder="/absolute/path/to/project"
              style={{
                flex: 1,
                background: 'var(--color-bg-input)',
                border: '1px solid #e7c54760',
                borderRadius: 3,
                color: 'var(--color-text-primary)',
                padding: '4px 7px',
                fontSize: 12,
                outline: 'none',
              }}
            />
            <button
              onClick={handleSetWorkspace}
              disabled={wsOpening || !wsInput.trim()}
              style={{
                background: '#e7c547',
                color: '#1e1e1e',
                borderRadius: 3,
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                cursor: wsOpening || !wsInput.trim() ? 'default' : 'pointer',
                opacity: wsOpening || !wsInput.trim() ? 0.6 : 1,
              }}
            >
              {wsOpening ? '…' : 'Open'}
            </button>
          </div>
          {wsError && <div style={{ marginTop: 4, color: '#f48771', fontSize: 11 }}>{wsError}</div>}
        </div>
      )}

      {/* Current workspace indicator */}
      {workspacePath && (
        <div
          style={{
            margin: '6px 8px 0',
            padding: '4px 8px',
            background: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            flexShrink: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={workspacePath}
        >
          {workspacePath}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 10px',
        }}
      >
        {uiMessages.length === 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 8,
              color: 'var(--color-text-secondary)',
              textAlign: 'center',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p style={{ fontSize: 12, margin: 0 }}>Ask about your code</p>
          </div>
        )}
        {uiMessages.map((msg, i) => (
          <MessageBubble key={msg.id} msg={msg} isLast={i === uiMessages.length - 1} providerLabel={provider.label} sendApproval={sendApproval} />
        ))}
      </div>

      {/* Input */}
      <div
        style={{
          borderTop: '1px solid var(--color-border)',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
          rows={3}
          disabled={isLoading}
          style={{
            background: 'var(--color-bg-sidebar)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            color: 'var(--color-text-primary)',
            fontSize: 12,
            padding: '6px 8px',
            resize: 'none',
            fontFamily: 'inherit',
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6 }}>
          {isLoading && (
            <button
              onClick={stopExecution}
              style={{
                background: '#f4877118',
                border: '1px solid #f4877160',
                borderRadius: 3,
                color: '#f48771',
                cursor: 'pointer',
                fontSize: 12,
                padding: '5px 14px',
                fontWeight: 600,
              }}
            >
              Stop
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            style={{
              background: isLoading || !input.trim() ? '#ffffff18' : '#0e639c',
              border: 'none',
              borderRadius: 3,
              color: isLoading || !input.trim() ? 'var(--color-text-secondary)' : '#fff',
              cursor: isLoading || !input.trim() ? 'default' : 'pointer',
              fontSize: 12,
              padding: '5px 14px',
              fontWeight: 600,
            }}
          >
            {isLoading ? 'Thinking…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}