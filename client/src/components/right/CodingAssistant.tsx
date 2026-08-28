import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef, KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCodingAssistant } from '../../hooks/useCodingAssistant';
import { openWorkspace } from '../../api/files';
import { fetchConversations, clearConversations as apiClearConversations, type ConversationRecord } from '../../api/conversations';
import { UIMessage, UIBlock } from '../../types';
import { PROVIDERS } from '../../providers';
import type { Provider } from '../../providers';
import type { FileNode } from '../../types';
import { useToolNarration } from '../../hooks/useToolNarration';
import { FilePathLink } from '../editor/FilePathLink';
import { parseFilePath, resolveFromRoot } from '../../utils/filePath';
import { RevertButton } from './RevertButton';
import { InlineSystemGraph } from './InlineSystemGraph';
import type { SystemGraph } from '../../api/files';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

export const RESPONSE_TRANSITIONS = {
  unskippable: ['Alright.', 'Okay.'],
  default: ['Understood.', 'That gives us the context.'],
} as const;

const SPEECH_OPTIONS = [
  { id: 'openai', label: 'OpenAI', model: 'tts-1-hd' },
  { id: 'google', label: 'Gemini', model: 'gemini-2.5-flash-preview-tts' },
] as const;
type SpeechProviderId = typeof SPEECH_OPTIONS[number]['id'];

function pathArgument(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const values = Object.values(input as Record<string, unknown>);
  return (values.find(value => typeof value === 'string' && value.includes('/')) as string | undefined) ?? null;
}

function argumentSummary(input: unknown): string | null {
  const path = pathArgument(input);
  if (!path) return null;
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] + '/' + parts[parts.length - 1] : parts[0] ?? null;
}

/** read_file uses start_line, open_file uses line. */
function lineArgument(input: unknown): number | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  const line = record.line ?? record.start_line;
  return typeof line === 'number' ? line : undefined;
}

function ToolBlock({ block, workspacePath, onNavigateToLine, onReverted }: { block: UIBlock & { type: 'tool' }; workspacePath: string | null; onNavigateToLine?: (filePath: string, line: number, endLine?: number, startCol?: number, endCol?: number) => void; onReverted?: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = JSON.stringify(block.input, null, 2);
  const pathLabel = argumentSummary(block.input);
  const fullPath = pathArgument(block.input);
  const openTarget = fullPath && workspacePath && onNavigateToLine && parseFilePath(fullPath) ? fullPath : null;
  const labelStyle: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-primary)' };
  const canRevert = !!onReverted && !block.pending && !block.error && (block.name === 'write_file' || block.name === 'edit_file');
  return (
    <div style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 6, marginBottom: 6, overflow: 'hidden' }}>
      <button onClick={() => setExpanded(e => !e)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 12px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 11, textAlign: 'left' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span style={{ width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: block.pending ? '#e7c54720' : block.error ? '#f4877120' : '#4ec9b020', color: block.pending ? '#e7c547' : block.error ? '#f48771' : '#4ec9b0', fontSize: 10, fontWeight: 700 }}>{block.pending ? '…' : block.error ? '✕' : '✓'}</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{block.name}</span>
          {pathLabel && (openTarget
            ? <FilePathLink path={openTarget} style={{ ...labelStyle, fontFamily: 'inherit' }} onOpen={() => onNavigateToLine!(resolveFromRoot(openTarget, workspacePath!), lineArgument(block.input) ?? 1)}>· {pathLabel}</FilePathLink>
            : <span style={labelStyle}>· {pathLabel}</span>)}
          {block.pending && <span style={{ fontSize: 10, fontStyle: 'italic' }}>running…</span>}
        </span>
        <span style={{ fontSize: 10, flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && <div style={{ padding: '0 12px 10px', fontSize: 11, fontFamily: 'monospace' }}><div style={{ color: 'var(--color-text-secondary)', marginBottom: 4 }}>Arguments:</div><pre style={{ margin: 0, padding: '7px 8px', background: 'var(--color-bg-editor)', border: '1px solid var(--color-border)', borderRadius: 5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--color-text-primary)', fontSize: 10 }}>{inputStr}</pre>{block.result !== undefined && <><div style={{ color: 'var(--color-text-secondary)', marginTop: 8, marginBottom: 4 }}>{block.error ? 'Error:' : 'Output:'}</div><pre style={{ margin: 0, padding: '7px 8px', background: 'var(--color-bg-code)', border: '1px solid var(--color-border)', borderRadius: 5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: block.error ? '#f48771' : 'var(--color-text-primary)', fontSize: 10, maxHeight: 220, overflowY: 'auto' }}>{block.result}</pre></>}{canRevert && <div style={{ marginTop: 8 }}><RevertButton toolCallId={block.id} onReverted={onReverted!} /></div>}</div>}
    </div>
  );
}

function ThoughtBlock({ block }: { block: UIBlock & { type: 'thought' } }) {
  return <div style={{ background: 'var(--color-bg-subtler)', borderLeft: '3px solid #4fc1ff', borderRadius: 6, padding: '6px 10px', marginBottom: 6, fontSize: 12, fontStyle: 'italic', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{block.content}</div>;
}

function CommandApprovalBlock({ block, onApprove, onReject }: { block: UIBlock & { type: 'command-approval' }; onApprove: () => void; onReject: () => void }) {
  const outputRef = useRef<HTMLPreElement>(null);
  const isPending = block.status === 'pending';
  const isApproved = block.status === 'approved';
  useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [block.output]);
  const borderColor = isPending ? '#e7c54760' : isApproved ? '#4ec9b040' : '#f4877140';
  const statusColor = isPending ? '#e7c547' : isApproved ? '#4ec9b0' : '#f48771';
  const statusBg = isPending ? '#e7c54720' : isApproved ? '#4ec9b020' : '#f4877120';
  return <div style={{ background: 'var(--color-bg-subtle)', border: `1px solid ${borderColor}`, borderRadius: 6, marginBottom: 8, overflow: 'hidden' }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--color-bg-subtler)', borderBottom: '1px solid var(--color-border)' }}><span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}><span>⚡</span><span style={{ fontWeight: 600 }}>Terminal command</span></span><span style={{ fontSize: 10, color: statusColor, background: statusBg, border: `1px solid ${statusColor}40`, borderRadius: 999, padding: '2px 7px' }}>{isPending ? 'waiting for approval' : isApproved ? 'approved' : 'rejected'}</span></div><div style={{ padding: '8px 10px' }}><div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 5 }}>{block.reason}</div><pre style={{ margin: '0 0 6px', padding: '7px 9px', background: 'var(--color-bg-editor)', border: '1px solid var(--color-border)', borderRadius: 5, fontSize: 12, fontFamily: 'monospace', color: 'var(--color-code-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>$ {block.command}</pre>{block.cwd && <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginBottom: 6 }}>in {block.cwd}</div>}{isPending && <div style={{ display: 'flex', gap: 6, marginTop: 4 }}><button onClick={onApprove} style={{ background: '#1e4a1e', border: '1px solid #4ec9b060', borderRadius: 999, color: '#4ec9b0', fontSize: 11, padding: '5px 13px', cursor: 'pointer', fontWeight: 600 }}>✓ Approve</button><button onClick={onReject} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 999, color: 'var(--color-text-secondary)', fontSize: 11, padding: '5px 13px', cursor: 'pointer' }}>✕ Reject</button></div>}{block.output && <pre ref={outputRef} style={{ marginTop: 8, padding: '7px 9px', background: 'var(--color-bg-code)', border: '1px solid var(--color-border)', borderRadius: 5, fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 220, overflowY: 'auto' }}>{block.output}</pre>}</div></div>;
}

function CodeBlock({ className, children }: React.ComponentPropsWithoutRef<'code'>) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = String(children).replace(/\n$/, '');

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <pre className="md-pre" style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Code copied' : 'Copy code'}
        title={copied ? 'Code copied' : 'Copy code'}
        style={{ position: 'absolute', top: 6, right: 6, padding: '2px 8px', fontSize: 10, background: copied ? '#4ec9b020' : 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 4, color: copied ? '#4ec9b0' : 'var(--color-text-secondary)', cursor: 'pointer', lineHeight: '16px' }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <code className={className}>{children}</code>
    </pre>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatConversationDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today at ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ' at ' + time;
}

function MicIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  );
}

function SpeakingWave() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 12 }}>
      {[0, 0.15, 0.05, 0.25, 0.1, 0.2, 0.08].map((delay, i) => (
        <span key={i} className="wave-bar" style={{ display: 'inline-block', width: 2, borderRadius: 1, background: 'currentColor', animationDelay: `${delay}s` }} />
      ))}
    </span>
  );
}

function MessageBubble({ msg, isLast, sendApproval, stopNarrationQueue, resolveApprovalNarration, onSuggestion, onVerbally, isSpeaking, isVerballyLoading, alwaysVerbally, onReverted, workspacePath, onNavigateToLine, shimmer }: { msg: UIMessage; isLast: boolean; sendApproval: (id: string, approved: boolean) => void; stopNarrationQueue: () => void; resolveApprovalNarration: (id: string, approved: boolean) => void; onSuggestion: (text: string) => void; onVerbally?: (text: string) => void; isSpeaking?: boolean; isVerballyLoading?: boolean; alwaysVerbally?: boolean; onReverted?: (path: string) => void; workspacePath: string | null; onNavigateToLine?: (filePath: string, line: number, endLine?: number, startCol?: number, endCol?: number) => void; shimmer?: boolean }) {
  const [liveShimmer, setLiveShimmer] = useState(false);
  useEffect(() => {
    if (shimmer) { setLiveShimmer(true); return; }
    const t = setTimeout(() => setLiveShimmer(false), 500);
    return () => clearTimeout(t);
  }, [shimmer]);
  if (msg.role === 'user') return <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}><div style={{ display: 'inline-flex', flexDirection: 'column', maxWidth: '100%' }}><div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><span>You</span><span style={{ fontWeight: 400, fontSize: 10 }}>{formatTime(msg.timestamp)}</span></div><div style={{ background: 'var(--color-bg-user-bubble)', borderRadius: 16, padding: '8px 10px', fontSize: 13, color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'left' }}>{msg.content}</div></div></div>;
  const isStreaming = msg.isStreaming;
  const hasFileTool = msg.blocks.some(block => block.type === 'tool' && (block.name === 'read_file' || block.name === 'write_file'));
  const verballyText = !isStreaming ? msg.blocks.filter((b): b is UIBlock & { type: 'text' } => b.type === 'text').map(b => b.content).join('\n\n').trim() : '';
  const chipStyle = (active: boolean): React.CSSProperties => ({ background: active ? '#4ec9b020' : 'var(--color-bg-subtle)', border: `1px solid ${active ? '#4ec9b060' : 'var(--color-border)'}`, borderRadius: 999, color: active ? '#4ec9b0' : 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 11, padding: active ? '5px 22px' : '5px 10px', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 5, transition: 'padding 0.4s ease, background 0.2s ease, border-color 0.2s ease, color 0.2s ease' });
  // Paths only become links once the message is complete — a half-streamed path can match too.
  const codeComponent = ({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'>) => {
    if (className?.startsWith('language-')) return <CodeBlock className={className} {...props}>{children}</CodeBlock>;
    const parsed = !isStreaming && workspacePath && onNavigateToLine ? parseFilePath(String(children)) : null;
    // An extension is required so prose like `and/or` stays plain text.
    if (parsed?.extension) {
      return <FilePathLink {...props} className="md-code-inline" path={parsed.path} onOpen={() => onNavigateToLine!(resolveFromRoot(parsed.path, workspacePath!), parsed.line ?? 1)}>{children}</FilePathLink>;
    }
    return <code className="md-code-inline" {...props}>{children}</code>;
  };
  return <div style={{ marginBottom: 12 }}><div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><img src="/logo.png" alt="Iodine" style={{ width: 14, height: 14, objectFit: 'contain' }} />Assistant</span><span style={{ fontWeight: 400, fontSize: 10 }}>{formatTime(msg.timestamp)}</span></div><div>{msg.blocks.map((block, i) => { if (block.type === 'text') { const showCursor = isStreaming && isLast && i === msg.blocks.length - 1; return <div key={i} style={{ position: 'relative' }}>{liveShimmer && <div style={{ position: 'absolute', inset: 0, zIndex: 2, overflow: 'hidden', opacity: shimmer ? 1 : 0, transition: 'opacity 500ms ease', pointerEvents: 'none', background: 'var(--color-bg-right-panel)', display: 'flex', flexDirection: 'column', gap: 8, padding: '3px 0' }}>{[88, 72, 95, 60, 83, 78, 45, 92, 55, 70, 38, 50].map((w, i) => <div key={i} style={{ flexShrink: 0, height: 14, width: `${w}%`, borderRadius: 4, background: 'var(--color-shimmer-base)', backgroundImage: 'linear-gradient(90deg, transparent 20%, var(--color-shimmer-highlight) 50%, transparent 80%)', backgroundSize: '200% 100%', animation: 'shimmer-sweep 1.8s ease-in-out infinite', animationDelay: `${-i * 0.12}s` }} />)}</div>}<div className="md-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: codeComponent }}>{block.content}</ReactMarkdown>{showCursor && <span style={{ animation: 'blink 1s step-end infinite', opacity: 1 }}>▌</span>}</div></div>; } if (block.type === 'thought') return <ThoughtBlock key={i} block={block} />; if (block.type === 'command-approval') return <CommandApprovalBlock key={block.id} block={block} onApprove={() => { resolveApprovalNarration(block.id, true); void sendApproval(block.id, true); }} onReject={() => { resolveApprovalNarration(block.id, false); void sendApproval(block.id, false); }} />; return <ToolBlock key={block.id} block={block} workspacePath={workspacePath} onNavigateToLine={onNavigateToLine} onReverted={onReverted} />; })}{!isStreaming && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>{hasFileTool && <button onClick={() => onSuggestion('Open file for me')} style={chipStyle(false)}>Open file for me</button>}{(verballyText.length > 120 || (alwaysVerbally && verballyText.length > 0)) && onVerbally && <button onClick={() => onVerbally(verballyText)} style={chipStyle(isSpeaking ?? false)} disabled={isVerballyLoading}>{isVerballyLoading ? 'Preparing…' : isSpeaking ? <SpeakingWave /> : 'Voice Memo'}</button>}</div>}{isStreaming && msg.blocks.length === 0 && <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', animation: 'blink 1s step-end infinite' }}>▌</span>}</div></div>;
}

export interface CodingAssistantHandle {
  injectProactiveMessage: (message: string, collectContext: () => Promise<string>) => void;
  notifyEditorActivity: () => void;
  focus: () => void;
}
interface CodingAssistantProps { workspacePath: string | null; activeFilePath: string | null; onWorkspaceOpen: (path: string) => void; provider: Provider; model: string; setProvider: (id: string) => void; setModel: (id: string) => void; getEditorContext?: () => string | null; contextNodes: FileNode[]; onRemoveContextNode: (path: string) => void; onClearContextNodes: () => void; onNavigateToLine?: (filePath: string, line: number, endLine?: number, startCol?: number, endCol?: number) => void; onOpenNode?: (nodeName: string, nodeId?: string) => void; activeSystemNode?: string | null; graph: SystemGraph; onOpenIogram: () => void; onUserTyping?: () => void; onMessageSent?: () => void; onAssistantBusyChange?: (busy: boolean) => void; onWatchTrigger?: () => void; onAssistantReply?: (text: string, hadToolUse: boolean) => void; onFileTreeRefresh?: () => void; onSummaryRequest?: (filePath: string) => void; commitDiffContext?: { shortHash: string; content: string } | null; onClearCommitDiffContext?: () => void; }

export const CodingAssistant = forwardRef<CodingAssistantHandle, CodingAssistantProps>(function CodingAssistant({ workspacePath, activeFilePath, onWorkspaceOpen, provider, model, setProvider, setModel, getEditorContext, contextNodes, onRemoveContextNode, onClearContextNodes, onNavigateToLine, onOpenNode, activeSystemNode, graph, onOpenIogram, onUserTyping, onMessageSent, onAssistantBusyChange, onWatchTrigger, onAssistantReply, onFileTreeRefresh, onSummaryRequest, commitDiffContext, onClearCommitDiffContext }, ref) {
  const [speechProviderId, setSpeechProviderId] = useState<SpeechProviderId>(() => (localStorage.getItem('iodine:speech-provider') as SpeechProviderId) ?? 'openai');
  useEffect(() => { localStorage.setItem('iodine:speech-provider', speechProviderId); }, [speechProviderId]);
  const speechOption = SPEECH_OPTIONS.find(o => o.id === speechProviderId) ?? SPEECH_OPTIONS[0];

  // Narration queue for tutor-mode tool call commentary — must be defined before useCodingAssistant.
  const {
    narrate: handleToolNarration,
    stop: stopNarrationQueue,
    drain: drainNarrationQueue,
    evictSkippable,
    resolveApprovalNarration,
    enqueueGreeting,
    setBridgeQuestion,
    queueRef: narrationQueueRef,
    audioRef: narrationAudioRef,
    hadNarrationsRef: turnHadNarrationsRef,
    hadUnskippableRef: turnHadUnskippableRef,
    unskippableCountRef: turnUnskippableCountRef,
    onEmptyRef: onNarrationQueueEmptyRef,
    resetTurn: resetNarrationRefs,
  } = useToolNarration(speechProviderId);

  const { uiMessages, isLoading, isWatching, conversationPersistenceError, canRetryConversationSave, conversationSaveRevision, sendMessage, enqueueEventContext, stopExecution, clearMessages, sendApproval, injectProactiveMessage, notifyEditorActivity, loadConversation, retryConversationSave, clearAllConversations } = useCodingAssistant(provider, model, workspacePath, onNavigateToLine, onWatchTrigger, onAssistantReply, handleToolNarration, onFileTreeRefresh, onSummaryRequest);
  // Keep a ref to sendMessage so callbacks (like transcribeAndSend) never capture a stale closure.
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const handleEditReverted = useCallback((path: string) => {
    onFileTreeRefresh?.();
    enqueueEventContext({
      id: crypto.randomUUID(),
      type: 'edit_reverted',
      source: 'revert_button',
      timestamp: Date.now(),
      summary: `The user reverted your edit to ${path}. The file is back to its contents from before that edit.`,
      state: 'cancelled',
      sideEffects: false,
      guidance: 'Do not assume the edit is still applied. Read the file again before changing it.',
    });
  }, [onFileTreeRefresh, enqueueEventContext]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ injectProactiveMessage, notifyEditorActivity, focus: () => textareaRef.current?.focus() }), [injectProactiveMessage, notifyEditorActivity]);
  const [input, setInput] = useState(''); const [isTutorMode, setIsTutorMode] = useState(true); const [providerStatus, setProviderStatus] = useState<Record<string, boolean>>({}); const [showHelp, setShowHelp] = useState(false); const apiConfigured = providerStatus[provider.id] ?? null; const [wsInput, setWsInput] = useState(''); const [wsOpening, setWsOpening] = useState(false); const [wsError, setWsError] = useState<string | null>(null); const scrollRef = useRef<HTMLDivElement>(null);
  const [pastConversations, setPastConversations] = useState<ConversationRecord[]>([]);
  const [showConversations, setShowConversations] = useState(false);
  const [conversationLoadError, setConversationLoadError] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [shimmerMsgId, setShimmerMsgId] = useState<string | null>(null);
  const [verballyLoadingId, setVerballyLoadingId] = useState<string | null>(null);
  const [verballyError, setVerballyError] = useState<string | null>(null);
  const [showVerballyDialog, setShowVerballyDialog] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevIsLoadingRef = useRef(false);
  // Ref mirrors: transcribeAndSend is a useCallback whose deps don't include these
  // state values, so refs give it non-stale access without widening the dep array.
  const pastConversationsRef = useRef<ConversationRecord[]>([]);
  const conversationLoadErrorRef = useRef<string | null>(null);
  const conversationsLoadingRef = useRef(true);
  // Guards the opening narration independently of transient message state.
  const hasGreetedCurrentThreadRef = useRef(false);
  // State (not ref) so handleSend can gate on it synchronously in the render closure.
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const refreshConversations = async (ws: string) => {
    try {
      const convs = await fetchConversations(ws);
      pastConversationsRef.current = convs;
      setPastConversations(convs);
      conversationLoadErrorRef.current = null;
      setConversationLoadError(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to load conversations';
      conversationLoadErrorRef.current = msg;
      setConversationLoadError(msg);
    } finally {
      conversationsLoadingRef.current = false;
      setConversationsLoading(false);
    }
  };
  useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading) textareaRef.current?.focus();
    prevIsLoadingRef.current = isLoading;
    onAssistantBusyChange?.(isLoading);
  }, [isLoading, onAssistantBusyChange]);
  // Fetch past conversations on mount and whenever the workspace changes
  useEffect(() => {
    if (!workspacePath) {
      pastConversationsRef.current = [];
      setPastConversations([]);
      conversationLoadErrorRef.current = null;
      setConversationLoadError(null);
      conversationsLoadingRef.current = false;
      setConversationsLoading(false);
      return;
    }
    conversationsLoadingRef.current = true;
    setConversationsLoading(true);
    conversationLoadErrorRef.current = null;
    setConversationLoadError(null);
    refreshConversations(workspacePath);
  }, [workspacePath]);
  // Refresh only after persistence succeeds, so a fast response cannot race
  // the list request ahead of the save.
  useEffect(() => {
    if (workspacePath && conversationSaveRevision > 0) refreshConversations(workspacePath);
  }, [workspacePath, conversationSaveRevision]);
  useEffect(() => { fetch(`${API_BASE}/api/agent/status`, { method: 'GET' }).then(r => r.json()).then(data => setProviderStatus(data.providers ?? { anthropic: data.configured })).catch(() => setProviderStatus({})); }, []);
  const handleSetWorkspace = async () => { if (!wsInput.trim()) return; setWsOpening(true); setWsError(null); try { const result = await openWorkspace(wsInput.trim()); if (result.path) { onWorkspaceOpen(result.path); setWsInput(''); } } catch (err) { setWsError(err instanceof Error ? err.message : 'Failed to open folder'); } finally { setWsOpening(false); } };
  useEffect(() => { if (!showConversations && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [uiMessages, showConversations]);
  const handleSend = () => { const text = input.trim(); if (!text || isLoading || conversationsLoading) return; stopNarrationQueue(); resetNarrationRefs(); setBridgeQuestion(text); setInput(''); const isFresh = showConversations; setShowConversations(false); if (isFresh) { clearMessages(); hasGreetedCurrentThreadRef.current = false; } if (!hasGreetedCurrentThreadRef.current && isTutorMode && !conversationLoadError) { enqueueGreeting(pastConversationsRef.current.length === 0 ? 'hello' : 'welcomeBack'); hasGreetedCurrentThreadRef.current = true; } const editorContext = getEditorContext?.() ?? null; const ctxPaths = contextNodes.map(n => !workspacePath ? n.path : n.path.startsWith(workspacePath + '/') ? n.path.slice(workspacePath.length + 1) : n.path); onClearContextNodes(); const extraCtx = commitDiffContext?.content ?? undefined; onClearCommitDiffContext?.(); sendMessage(text, activeFilePath, editorContext, ctxPaths.length > 0 ? ctxPaths : undefined, isTutorMode, isFresh, extraCtx); onMessageSent?.(); };
  const handleClearAll = async () => {
    try {
      await clearAllConversations();
      pastConversationsRef.current = [];
      setPastConversations([]);
      setShowConversations(false);
    } catch {
      // The hook exposes the persistence error without discarding the list.
    }
  };
  const handleLoadConversation = (conv: ConversationRecord) => {
    loadConversation(conv);
    hasGreetedCurrentThreadRef.current = true;
    setShowConversations(false);
  };
  const handleSuggestion = (text: string) => { setInput(text); onUserTyping?.(); };
  const handleVerbally = (msgId: string, text: string) => {
    stopNarrationQueue();
    setShimmerMsgId(null);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (speakingMsgId === msgId) { setSpeakingMsgId(null); return; }
    setVerballyError(null);
    setVerballyLoadingId(msgId);
    fetch(`${API_BASE}/api/tts/verbally`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, provider: speechOption.id, chatProvider: provider.id, chatModel: model }),
    })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        setVerballyLoadingId(null);
        setSpeakingMsgId(msgId);
        audio.play();
        audio.onended = () => { setSpeakingMsgId(null); URL.revokeObjectURL(url); };
      })
      .catch(err => {
        console.error('[Verbally]', err);
        setVerballyError(String(err.message ?? err));
        setVerballyLoadingId(null);
        setSpeakingMsgId(null);
      });
  };
  const stopRecording = useCallback(() => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
  }, []);

  const transcribeAndSend = useCallback(async (blob: Blob, mimeType: string) => {
    setIsTranscribing(true);
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const audioBase64 = btoa(binary);
      const r = await fetch(`${API_BASE}/api/stt/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType, provider: provider.id }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      const { text } = await r.json() as { text: string };
      if (text?.trim()) {
        const trimmedText = text.trim();
        stopNarrationQueue(); resetNarrationRefs(); setBridgeQuestion(trimmedText);
        const isFresh = showConversations;
        setShowConversations(false);
        if (isFresh) { clearMessages(); hasGreetedCurrentThreadRef.current = false; }
        if (!hasGreetedCurrentThreadRef.current && isTutorMode && !conversationsLoadingRef.current && !conversationLoadErrorRef.current) { enqueueGreeting(pastConversationsRef.current.length === 0 ? 'hello' : 'welcomeBack'); hasGreetedCurrentThreadRef.current = true; }
        sendMessageRef.current(trimmedText, activeFilePath, getEditorContext?.() ?? null, undefined, isTutorMode, isFresh);
        onMessageSent?.();
      }
    } catch (err) {
      console.error('[STT]', err);
    } finally {
      setIsTranscribing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id, activeFilePath, isTutorMode, showConversations, clearMessages]);

  const startRecording = useCallback(async () => {
    if (provider.id === 'anthropic') { setShowVerballyDialog(true); return; }
    const wasSpeaking = Boolean(narrationAudioRef.current || audioRef.current);
    // Stop any playing audio before recording so the mic doesn't pick it up.
    // Pause audio refs directly — do NOT call stopNarrationQueue() here as it
    // mutates the generation counter and can break subsequent narration flow.
    if (narrationAudioRef.current) { narrationAudioRef.current.pause(); narrationAudioRef.current = null; }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; setSpeakingMsgId(null); }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (isLoadingRef.current) stopExecution('microphone');
      else if (wasSpeaking) enqueueEventContext({
        id: crypto.randomUUID(),
        type: 'user_interrupted',
        source: 'microphone',
        timestamp: Date.now(),
        summary: 'The user interrupted the previous response using the microphone.',
        state: 'paused',
        guidance: 'Acknowledge the interruption naturally and address the new message directly. Resume, adapt, or abandon the prior task based on the user’s intent.',
      });
      recordingStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      // Silence detection
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const checkSilence = () => {
        if (mediaRecorderRef.current?.state !== 'recording') return;
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) sumSq += (data[i] - 128) ** 2;
        const rms = Math.sqrt(sumSq / data.length);
        if (rms < 5) {
          if (!silenceTimerRef.current) silenceTimerRef.current = setTimeout(() => stopRecording(), 1500);
        } else {
          if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
        }
        requestAnimationFrame(checkSilence);
      };

      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        ctx.close();
        stream.getTracks().forEach(t => t.stop());
        recordingStreamRef.current = null;
        setIsRecording(false);
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        void transcribeAndSend(blob, recorder.mimeType);
      };

      recorder.start(200);
      setIsRecording(true);
      requestAnimationFrame(checkSilence);
    } catch (err) {
      console.error('[STT] mic error', err);
    }
  }, [provider.id, stopRecording, transcribeAndSend, enqueueEventContext, stopExecution]);

  useEffect(() => () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    recordingStreamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  // Stop narrations when tutor mode is turned off or component unmounts.
  useEffect(() => { if (!isTutorMode) stopNarrationQueue(); }, [isTutorMode, stopNarrationQueue]);
  useEffect(() => () => stopNarrationQueue(), [stopNarrationQueue]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };
  const prevIsLoadingForAutoRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevIsLoadingForAutoRef.current;
    prevIsLoadingForAutoRef.current = isLoading;
    if (wasLoading && !isLoading && isTutorMode) {
      const lastMsg = uiMessages[uiMessages.length - 1];
      if (lastMsg?.role === 'assistant') {
        const text = lastMsg.blocks.filter((b): b is UIBlock & { type: 'text' } => b.type === 'text').map(b => b.content).join('\n\n').trim();
        // Enqueue the response audio after any tool narrations — do not interrupt them.
        if (text && provider.id !== 'anthropic') {
          const msgId = lastMsg.id;
          setShimmerMsgId(msgId);
          onNarrationQueueEmptyRef.current = () => setSpeakingMsgId(null);
          // Skip condensation for short, tool-free responses and speak the original text directly.
          // Greeting is already in the queue as a dedicated clip; response always receives none.
          const wordCount = text.split(/\s+/).length;
          const useDirectSpeech = wordCount < 15 && !turnHadNarrationsRef.current;
          const speechPromise = fetch(`${API_BASE}/api/tts/${useDirectSpeech ? 'speak' : 'verbally'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(useDirectSpeech
              ? { text, provider: speechOption.id }
              : { text, provider: speechOption.id, chatProvider: provider.id, chatModel: model }),
          }).then(async r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return URL.createObjectURL(await r.blob());
          });
          // Bridge exploration turns normally, and larger edit/write batches with a concise transition.
          // One or two edits already have enough narration and do not need an extra bridge.
          const shouldBridge = turnHadNarrationsRef.current
            && (!turnHadUnskippableRef.current || turnUnskippableCountRef.current >= 3);
          if (shouldBridge) {
            const transitions = turnUnskippableCountRef.current >= 3
              ? RESPONSE_TRANSITIONS.unskippable
              : RESPONSE_TRANSITIONS.default;
            const transition = transitions[Math.floor(Math.random() * transitions.length)];
            narrationQueueRef.current.push({
              skippable: false,
              fn: async () => {
                const r = await fetch(`${API_BASE}/api/tts/speak`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: transition, provider: speechOption.id }),
                });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return URL.createObjectURL(await r.blob());
              },
            });
          }
          // Evict remaining skippable narrations as soon as the response audio is ready.
          speechPromise.then(() => evictSkippable());
          narrationQueueRef.current.push({ fn: async () => { const url = await speechPromise; setSpeakingMsgId(msgId); setShimmerMsgId(null); return url; }, skippable: false });
          void drainNarrationQueue();
          turnHadNarrationsRef.current = false;
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);
  return <div className={isWatching ? 'assistant-panel assistant-panel-attention' : 'assistant-panel'} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}><style>{`@keyframes shimmer-sweep { 0% { background-position: 200% center; } 100% { background-position: -200% center; } } @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } } @keyframes wave-bar { from { height: 2px; } to { height: 11px; } } .wave-bar { animation: wave-bar 0.65s ease-in-out infinite alternate; } @keyframes watching-pulse { 0%, 100% { opacity: .4; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.15); } } @keyframes assistant-attention { 0%, 100% { box-shadow: inset 0 0 0 1px #e7c54770, 0 0 0 0 #e7c54700, 0 0 10px #e7c54745; } 50% { box-shadow: inset 0 0 0 2px #e7c547, 0 0 0 7px #e7c54735, 0 0 30px #e7c547aa; } } .assistant-panel-attention { animation: assistant-attention 1.15s ease-in-out infinite; } .watching-dot { display:inline-block; width:10px; height:10px; border-radius:50%; background:#e7c547; box-shadow:0 0 0 3px #e7c54745, 0 0 14px #e7c547; animation:watching-pulse .7s ease-in-out infinite; flex-shrink:0; } .watching-alert { color:#e7c547; font-weight:700; font-style:normal; text-shadow:0 0 8px #e7c54780; } .md-body { font-size:13px; color:var(--color-text-primary); line-height:1.6; word-break:break-word; margin-bottom:4px; } .md-body > *:first-child { margin-top:0; } .md-body > *:last-child { margin-bottom:0; } .md-body h1,.md-body h2,.md-body h3,.md-body h4 { font-weight:600; margin:10px 0 4px; } .md-body h1 { font-size:16px; } .md-body h2 { font-size:14px; } .md-body h3,.md-body h4 { font-size:13px; } .md-body p { margin:4px 0; } .md-body ul,.md-body ol { margin:4px 0; padding-left:18px; } .md-body li { margin:2px 0; } .md-body strong { font-weight:600; } .md-body em { font-style:italic; } .md-body blockquote { border-left:3px solid var(--color-border); margin:6px 0; padding:2px 10px; color:var(--color-text-secondary); } .md-body hr { border:none; border-top:1px solid var(--color-border); margin:8px 0; } .md-body a { color:#4fc1ff; text-decoration:underline; } .md-body table { border-collapse:collapse; font-size:12px; margin:6px 0; width:100%; } .md-body th,.md-body td { border:1px solid var(--color-border); padding:4px 8px; text-align:left; } .md-body th { background:#ffffff0a; font-weight:600; } .md-pre { background:var(--color-bg-editor); border:1px solid var(--color-border); border-radius:5px; padding:8px 10px; overflow-x:auto; margin:6px 0; font-size:12px; font-family:monospace; white-space:pre; } .md-code-inline { background:#ffffff12; border-radius:5px; padding:1px 4px; font-size:12px; font-family:monospace; }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: showHelp ? 'none' : '1px solid var(--color-border)', flexShrink: 0, gap: 6, height: 36 }}>
        {PROVIDERS.length === 1 ? <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', flexShrink: 0 }}>{provider.label}</span> : <select value={provider.id} onChange={e => setProvider(e.target.value)} style={{ background: 'var(--color-bg-sidebar)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-primary)', fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}>{PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>}
        <select value={model} onChange={e => setModel(e.target.value)} style={{ flex: 1, minWidth: 0, background: 'var(--color-bg-sidebar)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-primary)', fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}>{provider.id === 'openai' && <option value="dynamic">✦ Dynamic</option>}{provider.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
        <button onClick={() => setShowHelp(v => !v)} title="API key setup" style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid var(--color-border)', background: showHelp ? 'var(--color-bg-hover)' : 'none', color: 'var(--color-text-secondary)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 600, lineHeight: 1 }}>?</button>
        {pastConversations.length > 0 && <button onClick={() => setShowConversations(v => !v)} title="Browse past conversations" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: showConversations ? 'var(--color-bg-hover)' : 'none', border: '1px solid var(--color-border)', borderRadius: 999, padding: '2px 7px', fontSize: 10, color: showConversations ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', cursor: 'pointer', flexShrink: 0 }}>Conversations <span style={{ background: 'var(--color-bg-subtle)', borderRadius: 999, padding: '0 4px', fontSize: 10 }}>{pastConversations.length}</span></button>}
        {uiMessages.length > 0 && <button onClick={() => { clearMessages(); setShowConversations(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 10, padding: '2px 4px', flexShrink: 0 }} title="Clear chat">✕</button>}
      </div>
      {showHelp && <div style={{ margin: 0, padding: '10px 12px', background: 'var(--color-bg-subtle)', borderBottom: '1px solid var(--color-border)', fontSize: 12, flexShrink: 0 }}><div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>{provider.setupTitle}</div><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.6 }}>{provider.setupInstructions}</pre></div>}
      {apiConfigured === false && <div style={{ margin: '8px 8px 0', padding: '8px 10px', background: '#f487710a', border: '1px solid #f4877140', borderRadius: 4, fontSize: 12, color: '#f48771', flexShrink: 0 }}>No {provider.label} API key configured. Click <strong>?</strong> above for setup instructions.</div>}
      {apiConfigured === true && !workspacePath && <div style={{ margin: '8px 8px 0', padding: '8px 10px', background: '#e7c5470a', border: '1px solid #e7c54740', borderRadius: 4, fontSize: 12, color: '#e7c547', flexShrink: 0 }}><div style={{ marginBottom: 6 }}>No workspace set. Enter an absolute path so the assistant can read and write files.</div><div style={{ display: 'flex', gap: 6 }}><input type="text" value={wsInput} onChange={e => setWsInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSetWorkspace(); }} placeholder="/absolute/path/to/project" style={{ flex: 1, background: 'var(--color-bg-input)', border: '1px solid #e7c54760', borderRadius: 6, color: 'var(--color-text-primary)', padding: '4px 8px', fontSize: 12, outline: 'none' }} /><button onClick={handleSetWorkspace} disabled={wsOpening || !wsInput.trim()} style={{ background: '#e7c547', color: '#1e1e1e', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: wsOpening || !wsInput.trim() ? 'default' : 'pointer', opacity: wsOpening || !wsInput.trim() ? .6 : 1 }}>{wsOpening ? '…' : 'Open'}</button></div>{wsError && <div style={{ marginTop: 4, color: '#f48771', fontSize: 11 }}>{wsError}</div>}</div>}
      {workspacePath && <div style={{ margin: '6px 8px 0', padding: '4px 8px', background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 11, color: 'var(--color-text-secondary)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={workspacePath}>{workspacePath}</div>}
      {conversationLoadError && <div role="alert" style={{ margin: '6px 8px 0', padding: '6px 8px', background: '#f4877112', border: '1px solid #f4877160', borderRadius: 6, color: '#f48771', fontSize: 11, flexShrink: 0 }}>Conversation history could not be loaded.</div>}
      {conversationPersistenceError && <div role="alert" style={{ margin: '6px 8px 0', padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 8, background: '#f4877112', border: '1px solid #f4877160', borderRadius: 6, color: '#f48771', fontSize: 11, flexShrink: 0 }}><span style={{ flex: 1 }}>Conversation history could not be saved or cleared.</span>{canRetryConversationSave && <button onClick={retryConversationSave} style={{ background: 'none', border: '1px solid #f4877180', borderRadius: 999, color: '#f48771', cursor: 'pointer', fontSize: 10, padding: '2px 7px' }}>Retry</button>}</div>}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: showConversations || uiMessages.length === 0 ? '0' : '12px 10px' }}>
        {showConversations || (uiMessages.length === 0 && pastConversations.length > 0) ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 8px', flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button onClick={handleClearAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 11, padding: '2px 4px' }}>Clear all</button>
                {showConversations && uiMessages.length > 0 && <button onClick={() => setShowConversations(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 13, padding: '2px 4px', lineHeight: 1 }} title="Close">✕</button>}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {pastConversations.map(conv => (
                <button key={conv.id} onClick={() => handleLoadConversation(conv)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderTop: '1px solid var(--color-border)', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500 }}>{formatConversationDate(conv.timestamp)}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{conv.history.length} message{conv.history.length !== 1 ? 's' : ''}</div>
                </button>
              ))}
            </div>
          </div>
        ) : uiMessages.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: 'var(--color-text-secondary)', textAlign: 'center', padding: '12px 10px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .4 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2 2z" /></svg>
            <p style={{ fontSize: 12, margin: 0 }}>Ask about your code</p>
          </div>
        ) : null}
        {!showConversations && uiMessages.map((msg, i) => <MessageBubble key={msg.id} msg={msg} isLast={i === uiMessages.length - 1} sendApproval={sendApproval} stopNarrationQueue={stopNarrationQueue} resolveApprovalNarration={resolveApprovalNarration} onSuggestion={handleSuggestion} onVerbally={msg.role === 'assistant' ? (text) => handleVerbally(msg.id, text) : undefined} isSpeaking={speakingMsgId === msg.id} isVerballyLoading={verballyLoadingId === msg.id} alwaysVerbally={isTutorMode} onReverted={handleEditReverted} workspacePath={workspacePath} onNavigateToLine={onNavigateToLine} shimmer={isTutorMode && msg.role === 'assistant' && (isLoading ? i === uiMessages.length - 1 : shimmerMsgId === msg.id)} />)}
      </div>
      <InlineSystemGraph graph={graph} workspacePath={workspacePath} onOpenIogram={onOpenIogram} onNavigateToLine={onNavigateToLine} activeSystemNode={activeSystemNode} />
      <div style={{ borderTop: '1px solid var(--color-border)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
        {activeSystemNode && onOpenNode && <button onClick={() => onOpenNode(activeSystemNode)} title="Navigate to this node in System View" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: '1px solid var(--color-accent, #0e639c)', borderRadius: 999, padding: '2px 8px', fontSize: 11, color: 'var(--color-accent, #0e639c)', cursor: 'pointer', flexShrink: 0 }}>◎ {activeSystemNode}</button>}
        {commitDiffContext && <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(78,201,176,0.08)', border: '1px solid rgba(78,201,176,0.3)', borderRadius: 999, padding: '2px 6px 2px 7px', fontSize: 11, color: '#4ec9b0', alignSelf: 'flex-start', maxWidth: '100%' }}><span style={{ fontSize: 10, flexShrink: 0 }}>⎇</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>commit {commitDiffContext.shortHash}</span><button onClick={onClearCommitDiffContext} title="Remove diff context" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4ec9b0', fontSize: 12, lineHeight: 1, padding: '0 1px', flexShrink: 0 }}>×</button></div>}
        {contextNodes.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{contextNodes.map(node => <div key={node.path} style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 999, padding: '2px 6px 2px 7px', fontSize: 11, color: 'var(--color-text-secondary)', maxWidth: '100%' }}><span style={{ fontSize: 10, flexShrink: 0 }}>{node.type === 'directory' ? '📁' : '📄'}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span><button onClick={() => onRemoveContextNode(node.path)} title="Remove from context" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1, padding: '0 1px', flexShrink: 0 }}>×</button></div>)}</div>}
        {verballyError && <div style={{ padding: '6px 10px', background: '#f4877112', border: '1px solid #f4877160', borderRadius: 6, fontSize: 11, color: '#f48771', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span>🔊 Voice Memo: {verballyError}</span><button onClick={() => setVerballyError(null)} style={{ background: 'none', border: 'none', color: '#f48771', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 2px' }}>×</button></div>}
        {isWatching && <div className="watching-alert" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '7px 10px', border: '1px solid #e7c547', borderRadius: 6, background: '#e7c54718' }}><span className="watching-dot" />Assistant is actively watching your progress</div>}
        <textarea ref={textareaRef} value={input} onChange={e => { setInput(e.target.value); onUserTyping?.(); }} onKeyDown={handleKeyDown} placeholder="Ask anything… (Enter to send, Shift+Enter for newline)" rows={3} disabled={isLoading} style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 10, color: 'var(--color-text-primary)', fontSize: 12, padding: '9px 11px', resize: 'none', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Speech</span>
            <select value={speechProviderId} onChange={e => setSpeechProviderId(e.target.value as SpeechProviderId)} title="Speech model for Voice Memo" style={{ background: 'var(--color-bg-sidebar)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-secondary)', fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}>{SPEECH_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><button role="switch" aria-checked={isTutorMode} onClick={() => setIsTutorMode(v => !v)} title={isTutorMode ? 'Mentor Mode on — AI will guide without editing' : 'Enable Mentor Mode'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '5px 4px', color: isTutorMode ? '#4ec9b0' : 'var(--color-text-secondary)', fontSize: 11, fontWeight: isTutorMode ? 600 : 400 }}><span style={{ position: 'relative', width: 26, height: 15, borderRadius: 999, background: isTutorMode ? '#4ec9b0' : 'var(--color-border)', transition: 'background .15s ease', flexShrink: 0 }}><span style={{ position: 'absolute', top: 2, left: isTutorMode ? 13 : 2, width: 11, height: 11, borderRadius: '50%', background: '#fff', transition: 'left .15s ease' }} /></span>Mentor</button>{isLoading && <button onClick={() => stopExecution()} style={{ background: '#f4877118', border: '1px solid #f4877160', borderRadius: 999, color: '#f48771', cursor: 'pointer', fontSize: 12, padding: '5px 14px', fontWeight: 600 }}>Stop</button>}<button onClick={isRecording ? stopRecording : startRecording} disabled={isTranscribing} title={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing…' : 'Voice input'} style={{ background: isRecording ? '#f4877118' : 'none', border: `1px solid ${isRecording ? '#f48771' : 'var(--color-border)'}`, borderRadius: 999, color: isRecording ? '#f48771' : isTranscribing ? 'var(--color-text-secondary)' : 'var(--color-text-secondary)', cursor: isTranscribing ? 'default' : 'pointer', padding: '5px 8px', display: 'inline-flex', alignItems: 'center', transition: 'background 0.15s ease, border-color 0.15s ease' }}>{isTranscribing ? <span style={{ fontSize: 11 }}>…</span> : <MicIcon />}</button><button onClick={handleSend} disabled={isLoading || !input.trim()} style={{ background: isLoading || !input.trim() ? '#ffffff18' : '#0e639c', border: 'none', borderRadius: 999, color: isLoading || !input.trim() ? 'var(--color-text-secondary)' : '#fff', cursor: isLoading || !input.trim() ? 'default' : 'pointer', fontSize: 12, padding: '5px 15px', fontWeight: 600 }}>{isLoading ? 'Thinking…' : 'Send'}</button></div>
        </div>
      </div>
      {showVerballyDialog && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }} onClick={() => setShowVerballyDialog(false)}>
          <div style={{ background: 'var(--color-bg-sidebar)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '20px 22px', width: 280, boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 8 }}>🔊 Voice Memo requires OpenAI or Gemini</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>Anthropic does not offer a text-to-speech API. Switch to OpenAI or Gemini to use Voice Memo.</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {PROVIDERS.filter(p => p.id === 'openai' || p.id === 'google').map(p => (
                <button key={p.id} onClick={() => { setProvider(p.id); setShowVerballyDialog(false); }} style={{ flex: 1, padding: '6px 10px', borderRadius: 6, background: 'var(--color-accent, #0e639c)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{p.label}</button>
              ))}
              <button onClick={() => setShowVerballyDialog(false)} style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>;
});
CodingAssistant.displayName = 'CodingAssistant';
