import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useCodingAssistant } from '../../hooks/useCodingAssistant';
import { openWorkspace } from '../../api/files';
import { UIMessage, UIBlock, SONNET_MODELS } from '../../types';

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
        background: '#ffffff08',
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

function MessageBubble({ msg, isLast }: { msg: UIMessage; isLast: boolean }) {
  if (msg.role === 'user') {
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4, fontWeight: 600 }}>
          You
        </div>
        <div
          style={{
            background: '#ffffff0a',
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
        Claude
      </div>
      <div>
        {msg.blocks.map((block, i) => {
          if (block.type === 'text') {
            const showCursor = isStreaming && isLast && i === msg.blocks.length - 1;
            return (
              <div
                key={i}
                style={{ fontSize: 13, color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 4 }}
              >
                {block.content}
                {showCursor && (
                  <span style={{ animation: 'blink 1s step-end infinite', opacity: 1 }}>▌</span>
                )}
              </div>
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
  /** Current server-side workspace path (from WorkbenchLayout). Null when not set. */
  workspacePath: string | null;
  /** Called when the user sets a workspace via the inline input in this panel. */
  onWorkspaceOpen: (path: string) => void;
}

export function CodingAssistant({ workspacePath, onWorkspaceOpen }: CodingAssistantProps) {
  const { uiMessages, isLoading, model, setModel, sendMessage, clearMessages } = useCodingAssistant();
  const [input, setInput] = useState('');
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null);
  const [wsInput, setWsInput] = useState('');
  const [wsOpening, setWsOpening] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Check only API key on mount — workspace status comes via the workspacePath prop
  useEffect(() => {
    fetch(`${API_BASE}/api/agent/status`, { method: 'GET' })
      .then(r => r.json())
      .then(data => setApiConfigured(data.configured))
      .catch(() => setApiConfigured(false));
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
    sendMessage(text);
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
      `}</style>

      {/* Model bar */}
      <div
        style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
          gap: 8,
        }}
      >
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          style={{
            background: 'var(--color-bg-sidebar)',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            color: 'var(--color-text-primary)',
            fontSize: 11,
            padding: '2px 4px',
            cursor: 'pointer',
          }}
        >
          {SONNET_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>Anthropic</span>
          {uiMessages.length > 0 && (
            <button
              onClick={clearMessages}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
                fontSize: 10,
                padding: '2px 4px',
              }}
              title="Clear chat"
            >
              ✕
            </button>
          )}
        </div>
      </div>

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
          No API key found. Add your key to <code style={{ fontSize: 11 }}>~/.anthropic/api_key</code> or set <code style={{ fontSize: 11 }}>ANTHROPIC_API_KEY</code>.
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
                background: '#3c3c3c',
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
            background: '#ffffff06',
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
          <MessageBubble key={msg.id} msg={msg} isLast={i === uiMessages.length - 1} />
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
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          style={{
            alignSelf: 'flex-end',
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
  );
}
