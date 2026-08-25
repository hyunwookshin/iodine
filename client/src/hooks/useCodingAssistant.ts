import { useState, useRef, useCallback, useEffect } from 'react';
import { UIMessage, UIBlock, HistoryMessage } from '../types';
import type { Provider } from '../providers';
import { fetchOverallDiff } from '../api/files';
import { saveConversation, clearConversations, type ConversationRecord } from '../api/conversations';
import { createEventContextQueue, formatEventContext, type EventContext } from '../utils/eventContextQueue';
import { formatPlanState, isPlanActive, latestPlanFromMessages, type ActivePlan } from '../utils/planContext';

function uid() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/** Prepare UIMessages for disk persistence: clear transient flags. */
function normalizeForSave(msgs: UIMessage[]): UIMessage[] {
  return msgs.map(msg => {
    if (msg.role !== 'assistant') return msg;
    return {
      ...msg,
      isStreaming: false,
      blocks: msg.blocks.map(block => {
        if (block.type === 'tool') return { ...block, pending: false };
        if (block.type === 'command-approval' && block.status === 'pending') {
          return { ...block, status: 'rejected' as const };
        }
        if (block.type === 'edit-approval' && block.status === 'pending') {
          return { ...block, status: 'rejected' as const };
        }
        return block;
      }),
    };
  });
}

// Go directly to the Express server for SSE requests rather than through the Vite proxy.
// Vite's dev proxy (http-proxy) closes its connection to the backend shortly after
// forwarding the first SSE chunk — the browser's stream stays open on Vite's side but
// the Express res.on('close') fires, so the agent loop aborts before calling the API.
// Express already has CORS configured for localhost:5173, so cross-origin works fine.
// Non-streaming endpoints (/api/files/*, /api/agent/status) still go through the proxy.
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';
const FAST_API_BASE = 'http://localhost:8000'

export function useCodingAssistant(
  provider: Provider,
  model: string,
  workspacePath: string | null,
  onNavigateToLine?: (filePath: string, line: number, endLine?: number, startCol?: number, endCol?: number) => void,
  onWatchTrigger?: () => void,
  onAssistantReply?: (text: string, hadToolUse: boolean) => void,
  onToolNarration?: (name: string, input: Record<string, unknown>, approvalId?: string) => void,
  onFileTreeRefresh?: () => void,
  onSummaryRequest?: (filePath: string) => void,
) {
  const [uiMessages, setUiMessages] = useState<UIMessage[]>([]);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isWatching, setIsWatching] = useState(false);
  const [conversationPersistenceError, setConversationPersistenceError] = useState<string | null>(null);
  const [canRetryConversationSave, setCanRetryConversationSave] = useState(false);
  const [conversationSaveRevision, setConversationSaveRevision] = useState(0);

  // Keep a ref to the latest callback so sendMessage's useCallback closure
  // never goes stale (onNavigateToLine is not in the dependency array).
  const onNavigateToLineRef = useRef(onNavigateToLine);
  onNavigateToLineRef.current = onNavigateToLine;

  const onSummaryRequestRef = useRef(onSummaryRequest);
  onSummaryRequestRef.current = onSummaryRequest;

  const onWatchTriggerRef = useRef(onWatchTrigger);
  onWatchTriggerRef.current = onWatchTrigger;

  const onAssistantReplyRef = useRef(onAssistantReply);
  onAssistantReplyRef.current = onAssistantReply;

  const onToolNarrationRef = useRef(onToolNarration);
  onToolNarrationRef.current = onToolNarration;

  const onFileTreeRefreshRef = useRef(onFileTreeRefresh);
  onFileTreeRefreshRef.current = onFileTreeRefresh;

  // Tracks whether any tool was called in the current turn; reset at start of sendMessage.
  const toolUsedInTurnRef = useRef(false);

  // Refs that accumulate text/thought tokens between animation frames.
  // Prevents per-token re-renders when providers like OpenAI stream very fast.
  const textBufRef = useRef('');
  const thoughtBufRef = useRef('');
  const rafRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const watchControllerRef = useRef<AbortController | null>(null);

  // Accumulates all text_delta text for the current send (reset at start of sendMessage).
  // Used to capture final text synchronously in the done handler without reading React state.
  const streamingTextRef = useRef('');

  // Stable conversation ID for the current session. Reset on clearMessages / set on loadConversation.
  const conversationIdRef = useRef<string>(uid());
  const sessionGenerationRef = useRef(0);
  const previousWorkspacePathRef = useRef(workspacePath);

  type PendingConversationSave = {
    workspacePath: string;
    conversationId: string;
    generation: number;
    history: HistoryMessage[];
  };
  const pendingSaveRef = useRef<PendingConversationSave | null>(null);
  const failedSaveRef = useRef<PendingConversationSave | null>(null);
  const pendingProactiveContextRef = useRef<(() => Promise<string>) | null>(null);
  const eventContextQueueRef = useRef(createEventContextQueue());
  const armedReplyRef = useRef<string | null>(null);

  // Durable memory of the plan currently being planned/executed. Lives outside
  // React state so sendMessage can snapshot it synchronously, and survives
  // reloads by being rebuilt from persisted plan blocks (see loadConversation).
  const activePlanRef = useRef<ActivePlan | null>(null);

  // Keep workspacePath current without adding it to sendMessage's dependency array.
  const workspacePathRef = useRef(workspacePath);
  workspacePathRef.current = workspacePath;

  // A conversation belongs to exactly one workspace. Reset all in-memory
  // session state when that scope changes so history cannot cross projects.
  useEffect(() => {
    if (previousWorkspacePathRef.current === workspacePath) return;
    previousWorkspacePathRef.current = workspacePath;
    sessionGenerationRef.current += 1;
    abortControllerRef.current?.abort();
    watchControllerRef.current?.abort();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    textBufRef.current = '';
    thoughtBufRef.current = '';
    pendingProactiveContextRef.current = null;
    armedReplyRef.current = null;
    activePlanRef.current = null;
    pendingSaveRef.current = null;
    failedSaveRef.current = null;
    conversationIdRef.current = uid();
    setIsLoading(false);
    setIsWatching(false);
    setConversationPersistenceError(null);
    setCanRetryConversationSave(false);
    setUiMessages([]);
    setHistory([]);
  }, [workspacePath]);

  // Persist only after the completed assistant message has committed to React
  // state. Clearing the pending ref before awaiting makes this safe when
  // StrictMode runs effects more than once in development.
  useEffect(() => {
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    if (pending.generation !== sessionGenerationRef.current) return;

    const record: ConversationRecord = {
      id: pending.conversationId,
      timestamp: Date.now(),
      history: pending.history,
      uiMessages: normalizeForSave(uiMessages),
    };
    void saveConversation(pending.workspacePath, record)
      .then(() => {
        if (pending.generation !== sessionGenerationRef.current) return;
        failedSaveRef.current = null;
        setConversationPersistenceError(null);
        setCanRetryConversationSave(false);
        setConversationSaveRevision(revision => revision + 1);
      })
      .catch(error => {
        if (pending.generation !== sessionGenerationRef.current) return;
        failedSaveRef.current = pending;
        setCanRetryConversationSave(true);
        setConversationPersistenceError(error instanceof Error ? error.message : 'Failed to save conversation');
      });
  // uiMessages is listed so the effect reads committed state: the done handler
  // calls setUiMessages and setConversationSaveRevision in the same React batch,
  // so when this effect fires the completed message is already in uiMessages.
  // Runs during streaming are no-ops — pendingSaveRef is null until the reply
  // finishes, so the null guard at the top exits immediately every time.
  }, [conversationSaveRevision, uiMessages]);

  const injectProactiveMessage = useCallback((message: string, collectContext: () => Promise<string>) => {
    const proactiveMsg: UIMessage = {
      id: uid(),
      role: 'assistant',
      blocks: [{ type: 'text', content: message }],
      isStreaming: false,
      timestamp: Date.now(),
    };
    setUiMessages(prev => [...prev, proactiveMsg]);
    pendingProactiveContextRef.current = collectContext;
  }, []);

  const sendApproval = useCallback(async (id: string, approved: boolean) => {
    // Update block status immediately so buttons disappear
    setUiMessages(prev => prev.map(msg => {
      if (msg.role !== 'assistant') return msg;
      return {
        ...msg,
        blocks: msg.blocks.map(b =>
          b.type === 'command-approval' && b.id === id
            ? { ...b, status: (approved ? 'approved' : 'rejected') as 'approved' | 'rejected' }
            : b
        ),
      };
    }));
    try {
      await fetch(`${API_BASE}/api/agent/terminal/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, approved }),
      });
    } catch {
      // timeout on server will reject automatically
    }
  }, []);

  /** Approve or skip a pending edit while executing in manual review mode. */
  const sendEditApproval = useCallback(async (id: string, approved: boolean) => {
    // Update block status immediately so buttons disappear
    setUiMessages(prev => prev.map(msg => {
      if (msg.role !== 'assistant') return msg;
      return {
        ...msg,
        blocks: msg.blocks.map(b =>
          b.type === 'edit-approval' && b.id === id
            ? { ...b, status: (approved ? 'approved' : 'rejected') as 'approved' | 'rejected' }
            : b
        ),
      };
    }));
    try {
      await fetch(`${API_BASE}/api/agent/edit/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, approved }),
      });
    } catch {
      // timeout on server will reject automatically
    }
  }, []);

  const stopExecution = useCallback((source: 'stop_button' | 'microphone' = 'stop_button') => {
    const controller = abortControllerRef.current;
    if (!controller || controller.signal.aborted) return;

    eventContextQueueRef.current.enqueue({
      id: uid(),
      type: 'user_interrupted',
      source,
      timestamp: Date.now(),
      summary: source === 'microphone'
        ? 'The user interrupted the previous response using the microphone.'
        : 'The user stopped the previous response.',
      state: 'paused',
      guidance: 'IMPORTANT: You MUST acknowledge the interruption when natural—for example, that the user may want to change direction, refine the request, or ask something before continuing. Do not use a canned acknowledgment or assume why they interrupted. Address the new message directly. Resume, adapt, or abandon the prior task when their intent is clear; clarify only when ambiguous, but do acknowledge at all times.',
    });
    controller.abort();
  }, []);

  useEffect(() => () => {
    sessionGenerationRef.current += 1;
    pendingSaveRef.current = null;
    failedSaveRef.current = null;
    abortControllerRef.current?.abort();
    watchControllerRef.current?.abort();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Progress Watch ────────────────────────────────────────────────────────────

  // Stream the AI progress-check response as a new assistant message.
  const runProgressCheck = useCallback(async (
    previousReply: string,
    diffs: string[],
    watchController: AbortController,
  ) => {
    const watchGeneration = sessionGenerationRef.current;
    const assistantId = uid();
    const assistantMsg: UIMessage = { id: assistantId, role: 'assistant', blocks: [], isStreaming: true, timestamp: Date.now() };

    setUiMessages(prev => [...prev, assistantMsg]);
    setIsLoading(true);
    onWatchTriggerRef.current?.(); // bell + pulse

    const updateWatchMsg = (updater: (msg: UIMessage & { role: 'assistant' }) => UIMessage) => {
      if (watchGeneration !== sessionGenerationRef.current) return;
      setUiMessages(prev => prev.map(m =>
        m.id === assistantId && m.role === 'assistant'
          ? updater(m as UIMessage & { role: 'assistant' })
          : m
      ));
    };

    let watchText = '';

    try {
      const response = await fetch(`${API_BASE}/api/proactive/watch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previousReply, diffSnapshots: diffs, model, provider: provider.id }),
        signal: watchController.signal,
      });

      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        if (watchGeneration !== sessionGenerationRef.current) return;
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const chunks = buf.split('\n\n');
        buf = chunks.pop() ?? '';

        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          const lines = chunk.split('\n');
          let eventName = '';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }
          if (!eventName || !dataStr) continue;

          let payload: Record<string, unknown>;
          try { payload = JSON.parse(dataStr); } catch { continue; }

          if (eventName === 'text_delta') {
            const text = payload.text as string;
            watchText += text;
            updateWatchMsg(msg => {
              const blocks = [...msg.blocks];
              const last = blocks[blocks.length - 1];
              if (last?.type === 'text') {
                blocks[blocks.length - 1] = { ...last, content: last.content + text } as UIBlock;
              } else {
                blocks.push({ type: 'text', content: text } as UIBlock);
              }
              return { ...msg, blocks };
            });
          } else if (eventName === 'done') {
            updateWatchMsg(msg => {
              setHistory(h => [...h, { role: 'assistant', content: watchText }]);
              return { ...msg, isStreaming: false };
            });
          } else if (eventName === 'error') {
            updateWatchMsg(msg => ({
              ...msg,
              isStreaming: false,
              blocks: [...msg.blocks, { type: 'text', content: `Error: ${payload.message as string}` }],
            }));
          }
        }
      }
    } catch {
      // Aborted or network error — remove the placeholder if empty, else mark done.
      setUiMessages(prev => {
        const msg = prev.find(m => m.id === assistantId && m.role === 'assistant') as (UIMessage & { role: 'assistant' }) | undefined;
        if (!msg) return prev;
        const hasContent = msg.blocks.some(b => 'content' in b && typeof (b as { content?: string }).content === 'string' && (b as { content: string }).content.trim().length > 0);
        if (!hasContent) return prev.filter(m => m.id !== assistantId);
        return prev.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m);
      });
    } finally {
      if (watchGeneration === sessionGenerationRef.current) setIsLoading(false);
    }
  }, [model, provider]);

  // Stored in a ref so startProgressWatch (stable deps) always calls the latest version.
  const runProgressCheckRef = useRef(runProgressCheck);
  runProgressCheckRef.current = runProgressCheck;

  // Capture three git diff snapshots at 5, 15, and 30 seconds, then fire the progress check.
  const startProgressWatch = useCallback(async (previousReply: string) => {
    watchControllerRef.current?.abort();
    const controller = new AbortController();
    watchControllerRef.current = controller;
    setIsWatching(true);

    const diffs: string[] = [];
    // Snapshots are taken at 5s, 15s, and 30s after the AI reply.
    // Intervals between captures: 5s → 10s → 15s.
    const INTERVALS = [5_000, 10_000, 15_000];

    try {
      for (const delay of INTERVALS) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, delay);
          const onAbort = () => { clearTimeout(t); reject(new DOMException('watch aborted', 'AbortError')); };
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        if (controller.signal.aborted) return;
        try {
          const { diff } = await fetchOverallDiff();
          diffs.push(diff);
        } catch {
          diffs.push('');
        }
      }

      if (controller.signal.aborted) return;

      // Only fire if the user actually made changes
      const hasDiff = diffs.some(d => d.trim().length > 0);
      if (!hasDiff) return;

      await runProgressCheckRef.current(previousReply, diffs, controller);
    } catch {
      // Silently stop on abort or unexpected error
    } finally {
      if (watchControllerRef.current === controller) watchControllerRef.current = null;
      setIsWatching(false);
    }
  }, []); // stable — only reads from refs and setState

  // Stored in a ref so the done handler inside sendMessage can call the latest version.
  const startProgressWatchRef = useRef(startProgressWatch);
  startProgressWatchRef.current = startProgressWatch;

  // Called when the user types in the editor. If a reply is armed, starts the watch window.
  const notifyEditorActivity = useCallback(() => {
    const reply = armedReplyRef.current;
    if (!reply) return;
    armedReplyRef.current = null;
    void startProgressWatchRef.current(reply);
  }, []); // stable — only reads refs

  // ── sendMessage ───────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string, activeFilePath?: string | null, editorContext?: string | null, contextPaths?: string[], tutorMode?: boolean, fresh?: boolean, extraContext?: string | null, planningMode?: boolean) => {
    if (!text.trim() || isLoading) return;

    const sendWorkspacePath = workspacePathRef.current;
    const sendConversationId = conversationIdRef.current;
    const sendGeneration = sessionGenerationRef.current;

    // Cancel any in-progress watch and clear any armed reply before starting a new message.
    armedReplyRef.current = null;
    watchControllerRef.current?.abort();
    setIsWatching(false);
    streamingTextRef.current = '';
    toolUsedInTurnRef.current = false;

    const userMsg: UIMessage = { id: uid(), role: 'user', content: text, timestamp: Date.now() };
    const assistantId = uid();
    const assistantMsg: UIMessage = { id: assistantId, role: 'assistant', blocks: [], isStreaming: true, timestamp: Date.now() };

    // Collect proactive context if a signal fired before this message.
    // Injected into the API content only — the UI shows only the user's typed text.
    const collectProactive = pendingProactiveContextRef.current;
    pendingProactiveContextRef.current = null;
    let proactiveContext = '';
    if (collectProactive) {
      try { proactiveContext = await collectProactive(); } catch { /* ignore — context is best-effort */ }
    }

    if (sendGeneration !== sessionGenerationRef.current) return;

    const pendingEvents = eventContextQueueRef.current.snapshot();
    const eventContext = formatEventContext(pendingEvents);

    let apiContent = text;
    if (eventContext) {
      apiContent = `${eventContext}\n\n---\n${apiContent}`;
    }
    // Durable plan memory: while a plan is approved/executing, every request
    // carries its full state so the model knows the phase and what remains.
    const planSnapshot = activePlanRef.current;
    const planContext = planSnapshot && isPlanActive(planSnapshot) ? formatPlanState(planSnapshot) : '';
    if (planContext) {
      apiContent = `${planContext}\n\n---\n${apiContent}`;
    }
    if (proactiveContext) {
      apiContent = `**Context at the time of the assistant's proactive message (for reference only — respond conversationally, do not call any tools):**\n${proactiveContext}\n\n---\n${apiContent}`;
    }
    if (contextPaths && contextPaths.length > 0) {
      apiContent += `\n\n---\n**Relevant paths hint** (check these paths first when looking for relevant code):\n${contextPaths.map(p => `- \`${p}\``).join('\n')}`;
    }
    if (editorContext) {
      apiContent += `\n\n---\n**User Visual Context** (currently visible in editor):\n\`\`\`\n${editorContext}\n\`\`\``;
    }
    if (extraContext) {
      apiContent += `\n\n---\n${extraContext}`;
    }
    const newHistory: HistoryMessage[] = [...(fresh ? [] : history), { role: 'user', content: apiContent }];
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setUiMessages(fresh ? [userMsg, assistantMsg] : (prev => [...prev, userMsg, assistantMsg]));
    setHistory(newHistory);
    setIsLoading(true);

    try {
      let modelToUse = model;
      if (model === 'dynamic' && provider.id === 'openai') {
        try {
          const routeResponse = await fetch(`${FAST_API_BASE}/api/route`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({prompt: newHistory, models: provider.models}),
            signal: controller.signal,
          });
          if (routeResponse.ok) {
            const routeData = await routeResponse.json();
            modelToUse = routeData.selected_model.id;
          } else {
            modelToUse = provider.models[0]?.id ?? model;
          }
        } catch {
          // Routing service unavailable — fall back to first model
          modelToUse = provider.models[0]?.id ?? model;
        }
      }

      const response = await fetch(`${API_BASE}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newHistory,
          model: modelToUse,
          provider: provider.id,
          activeFile: activeFilePath ?? null,
          tutorMode: tutorMode ?? false,
          planningMode: planningMode ?? false,
          planActive: isPlanActive(activePlanRef.current),
          editApproval: activePlanRef.current?.executionMode ?? 'auto',
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      eventContextQueueRef.current.consume(pendingEvents.map(event => event.id));

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const updateAssistant = (updater: (msg: UIMessage & { role: 'assistant' }) => UIMessage) => {
        if (sendGeneration !== sessionGenerationRef.current) return;
        setUiMessages(prev => prev.map(m =>
          m.id === assistantId && m.role === 'assistant'
            ? updater(m as UIMessage & { role: 'assistant' })
            : m
        ));
      };

      // Drain both text/thought buffers into state in one React update.
      // Called either by RAF (at most once per frame) or synchronously before
      // structural events (tool_call, done, etc.) to preserve block ordering.
      const flushBufs = () => {
        rafRef.current = null;
        if (sendGeneration !== sessionGenerationRef.current) return;
        const txt = textBufRef.current;
        const tht = thoughtBufRef.current;
        textBufRef.current = '';
        thoughtBufRef.current = '';
        if (!txt && !tht) return;
        updateAssistant(msg => {
          const blocks = [...msg.blocks];
          // thoughts always precede answer text, so flush thought first
          for (const [buf, blockType] of [[tht, 'thought'], [txt, 'text']] as [string, 'thought' | 'text'][]) {
            if (!buf) continue;
            const last = blocks[blocks.length - 1];
            if (last?.type === blockType) {
              blocks[blocks.length - 1] = { ...last, content: last.content + buf } as UIBlock;
            } else {
              blocks.push({ type: blockType, content: buf } as UIBlock);
            }
          }
          return { ...msg, blocks };
        });
      };

      // Cancel any pending RAF and flush synchronously — call before every
      // non-text event so that block ordering in the UI stays correct.
      const flushNow = () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        flushBufs();
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          if (sendGeneration !== sessionGenerationRef.current) return;
          if (!chunk.trim()) continue;

          const lines = chunk.split('\n');
          let eventName = '';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }

          if (!eventName || !dataStr) continue;

          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (eventName === 'open_file') {
            const filePath = payload.path as string;
            const line = payload.line as number;
            const endLine = payload.endLine as number | undefined;
            const startCol = payload.startCol as number | undefined;
            const endCol = payload.endCol as number | undefined;
            if (filePath) {
              onNavigateToLineRef.current?.(filePath, line, endLine, startCol, endCol);
            }
          } else if (eventName === 'invoke_summary') {
            const filePath = payload.path as string;
            if (filePath) onSummaryRequestRef.current?.(filePath);
          } else if (eventName === 'git_commit_compose') {
            const message = payload.message as string;
            if (message) {
              window.dispatchEvent(new CustomEvent('iodine:git-commit-compose', { detail: { message } }));
            }
          } else if (eventName === 'plan') {
            flushNow();
            const title = typeof payload.title === 'string' ? payload.title : '';
            const steps = Array.isArray(payload.steps)
              ? payload.steps.map(s => ({ text: String(s), done: false }))
              : [];
            if (!title || steps.length === 0) continue;
            const planId = uid();
            const planBlock: UIBlock = { type: 'plan', id: planId, title, steps, status: 'proposed' };
            updateAssistant(msg => ({ ...msg, blocks: [...msg.blocks, planBlock] }));
            activePlanRef.current = { id: planId, title, steps: steps.map(s => ({ ...s })), status: 'proposed' };
          } else if (eventName === 'plan_update') {
            flushNow();
            const index = typeof payload.index === 'number' ? Math.floor(payload.index) : NaN;
            const summary = typeof payload.summary === 'string' ? payload.summary : '';
            if (!Number.isFinite(index) || index < 1) continue;
            const stepIdx = index - 1;
            const plan = activePlanRef.current;
            if (!plan) continue;
            // Patch every matching plan block (the block lives in an earlier
            // message than the one currently streaming).
            setUiMessages(prev => prev.map(msg => {
              if (msg.role !== 'assistant') return msg;
              let changed = false;
              const blocks = msg.blocks.map(b => {
                if (b.type !== 'plan' || b.id !== plan.id || b.status === 'proposed') return b;
                if (stepIdx >= b.steps.length) return b;
                changed = true;
                const steps = b.steps.map((s, si) => si === stepIdx && !s.done ? { ...s, done: true, summary } : s);
                return { ...b, steps, status: steps.every(s => s.done) ? 'completed' as const : 'executing' as const };
              });
              return changed ? { ...msg, blocks } : msg;
            }));
            const steps = plan.steps.map((s, si) => si === stepIdx && !s.done ? { ...s, done: true, summary } : s);
            activePlanRef.current = { ...plan, steps, status: steps.every(s => s.done) ? 'completed' : 'executing' };
          } else if (eventName === 'edit_approval') {
            flushNow();
            const approvalBlock: UIBlock = {
              type: 'edit-approval',
              id: payload.id as string,
              op: payload.op === 'write' ? 'write' : 'edit',
              path: payload.path as string,
              preview: payload.preview as string,
              status: 'pending',
            };
            updateAssistant(msg => ({ ...msg, blocks: [...msg.blocks, approvalBlock] }));
          } else if (eventName === 'text_delta') {
            const text = payload.text as string;
            // Buffer for animation-frame batching
            textBufRef.current += text;
            // Also accumulate in streamingTextRef so done handler can capture full text
            streamingTextRef.current += text;
            if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushBufs);
          } else if (eventName === 'thought_delta') {
            thoughtBufRef.current += payload.text as string;
            if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushBufs);
          } else if (eventName === 'tool_call') {
            flushNow();
            toolUsedInTurnRef.current = true;
            if (tutorMode) {
              onToolNarrationRef.current?.(payload.name as string, payload.input as Record<string, unknown>, payload.approval_id as string | undefined);
            }
            const toolBlock: UIBlock = {
              type: 'tool',
              id: payload.id as string,
              name: payload.name as string,
              input: payload.input as Record<string, unknown>,
              pending: true,
            };
            updateAssistant(msg => ({ ...msg, blocks: [...msg.blocks, toolBlock] }));
          } else if (eventName === 'command_approval') {
            flushNow();
            const approvalBlock: UIBlock = {
              type: 'command-approval',
              id: payload.id as string,
              command: payload.command as string,
              reason: payload.reason as string,
              cwd: payload.cwd as string | null,
              longRunning: payload.longRunning as boolean,
              status: 'pending',
              output: '',
            };
            updateAssistant(msg => ({ ...msg, blocks: [...msg.blocks, approvalBlock] }));
          } else if (eventName === 'command_output') {
            const { id, data } = payload as { id: string; stream: string; data: string };
            updateAssistant(msg => ({
              ...msg,
              blocks: msg.blocks.map(b =>
                b.type === 'command-approval' && b.id === id
                  ? { ...b, output: b.output + data }
                  : b
              ),
            }));
          } else if (eventName === 'tool_result') {
            flushNow();
            const toolUseId = payload.tool_use_id as string;
            const succeeded = !payload.error;
            let completedToolName: string | undefined;
            updateAssistant(msg => ({
              ...msg,
              blocks: msg.blocks.map(b => {
                if (b.type !== 'tool' || b.id !== toolUseId) return b;
                completedToolName = b.name;
                return { ...b, result: payload.preview as string, error: payload.error as boolean, pending: false };
              }),
            }));
            if (succeeded && completedToolName === 'write_file') {
              onFileTreeRefreshRef.current?.();
            }
          } else if (eventName === 'done') {
            flushNow();
            const capturedText = streamingTextRef.current;
            const finalHistory: HistoryMessage[] = [...newHistory, { role: 'assistant', content: capturedText }];
            updateAssistant(msg => ({ ...msg, isStreaming: false }));
            setHistory(finalHistory);
            if (sendWorkspacePath && capturedText.trim()) {
              pendingSaveRef.current = {
                workspacePath: sendWorkspacePath,
                conversationId: sendConversationId,
                generation: sendGeneration,
                history: finalHistory,
              };
              setConversationSaveRevision(revision => revision + 1);
            }
            // Notify expansion hook so it can grow/shrink the right panel.
            onAssistantReplyRef.current?.(capturedText, toolUsedInTurnRef.current);
            // Arm the watch — it will start when the user next types in the editor.
            if (capturedText.trim()) {
              armedReplyRef.current = capturedText;
            }
          } else if (eventName === 'error') {
            flushNow();
            const errText = payload.message as string;
            updateAssistant(msg => ({
              ...msg,
              isStreaming: false,
              blocks: [...msg.blocks, { type: 'text', content: `Error: ${errText}` }],
            }));
          }
        }
      }
    } catch (err) {
      if (sendGeneration !== sessionGenerationRef.current) return;
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      const bufferedText = textBufRef.current;
      const bufferedThought = thoughtBufRef.current;
      textBufRef.current = '';
      thoughtBufRef.current = '';
      const stopped = controller.signal.aborted;
      const errText = err instanceof Error ? err.message : 'Unknown error';
      // Stopping mid-execution parks the plan as paused so the next message
      // carries <PlanState> and the card offers Resume.
      const pausedPlan = stopped ? activePlanRef.current : null;
      const pausable = !!pausedPlan && (pausedPlan.status === 'approved' || pausedPlan.status === 'executing');
      if (pausable && pausedPlan) {
        activePlanRef.current = { ...pausedPlan, status: 'paused' };
      }
      const pausedPlanId = pausable && pausedPlan ? pausedPlan.id : null;
      const isPausableBlock = (s: string) => s === 'executing' || s === 'approved';
      setUiMessages(prev => prev.map(m => {
        if (m.id !== assistantId || m.role !== 'assistant') {
          if (pausedPlanId) {
            return m.role === 'assistant'
              ? { ...m, blocks: m.blocks.map(b => b.type === 'plan' && b.id === pausedPlanId && isPausableBlock(b.status) ? { ...b, status: 'paused' as const } : b) }
              : m;
          }
          return m;
        }
        const blocks = [...m.blocks];
        for (const [content, type] of [[bufferedThought, 'thought'], [bufferedText, 'text']] as [string, 'thought' | 'text'][]) {
          if (!content) continue;
          const last = blocks[blocks.length - 1];
          if (last?.type === type) blocks[blocks.length - 1] = { ...last, content: last.content + content } as UIBlock;
          else blocks.push({ type, content } as UIBlock);
        }
        if (stopped) {
          blocks.push({ type: 'text', content: '_Execution stopped._' });
        } else {
          blocks.push({ type: 'text', content: `Error: ${errText}` });
        }
        return { ...m, isStreaming: false, blocks };
      }));
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      if (sendGeneration === sessionGenerationRef.current) setIsLoading(false);
    }
  }, [history, isLoading, model, provider]);

  /** Approve a proposed plan and immediately start executing it. */
  const approvePlan = useCallback((planId: string, executionMode: 'auto' | 'manual') => {
    const plan = activePlanRef.current;
    if (!plan || plan.id !== planId || plan.status !== 'proposed') return;
    activePlanRef.current = { ...plan, status: 'approved', executionMode };
    setUiMessages(prev => prev.map(msg => {
      if (msg.role !== 'assistant') return msg;
      return {
        ...msg,
        blocks: msg.blocks.map(b =>
          b.type === 'plan' && b.id === planId ? { ...b, status: 'approved' as const, executionMode } : b
        ),
      };
    }));
    void sendMessage(
      executionMode === 'manual'
        ? 'Approved — execute the plan. Ask me to review each file change before you apply it.'
        : 'Approved — execute the plan.',
      undefined, undefined, undefined, undefined, false, undefined, false,
    );
  }, [sendMessage]);

  /** Resume a paused/interrupted plan from its next pending step. */
  const resumePlan = useCallback(() => {
    const plan = activePlanRef.current;
    if (!plan || !isPlanActive(plan)) return;
    activePlanRef.current = { ...plan, status: 'executing' };
    setUiMessages(prev => prev.map(msg => {
      if (msg.role !== 'assistant') return msg;
      return {
        ...msg,
        blocks: msg.blocks.map(b =>
          b.type === 'plan' && b.id === plan.id && b.status === 'paused'
            ? { ...b, status: 'executing' as const }
            : b
        ),
      };
    }));
    void sendMessage('Continue executing the plan from the next pending step.', undefined, undefined, undefined, undefined, false, undefined, false);
  }, [sendMessage]);

  const clearMessages = useCallback(() => {
    sessionGenerationRef.current += 1;
    armedReplyRef.current = null;
    abortControllerRef.current?.abort();
    watchControllerRef.current?.abort();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    pendingSaveRef.current = null;
    failedSaveRef.current = null;
    setConversationPersistenceError(null);
    setCanRetryConversationSave(false);
    setIsLoading(false);
    setIsWatching(false);
    conversationIdRef.current = uid(); // fresh ID for the next conversation
    activePlanRef.current = null;
    setUiMessages([]);
    setHistory([]);
  }, []);

  /** Restore a saved conversation into the chat (replaces current state). */
  const loadConversation = useCallback((record: ConversationRecord) => {
    sessionGenerationRef.current += 1;
    armedReplyRef.current = null;
    abortControllerRef.current?.abort();
    watchControllerRef.current?.abort();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    pendingSaveRef.current = null;
    failedSaveRef.current = null;
    setConversationPersistenceError(null);
    setCanRetryConversationSave(false);
    setIsLoading(false);
    setIsWatching(false);
    conversationIdRef.current = record.id;
    // Rebuild plan memory from persisted blocks. A plan saved mid-execution has
    // nothing in flight anymore, so it resumes life as paused until the user
    // explicitly continues.
    const restoredPlan = latestPlanFromMessages(record.uiMessages ?? []);
    if (restoredPlan && restoredPlan.status === 'executing') {
      activePlanRef.current = { ...restoredPlan, status: 'paused' };
      for (const msg of record.uiMessages) {
        if (msg.role !== 'assistant') continue;
        msg.blocks = msg.blocks.map(b => {
          if (b.type !== 'plan' || b.id !== restoredPlan.id || b.status !== 'executing') return b;
          const paused: typeof b = { type: 'plan', id: b.id, title: b.title, steps: b.steps, status: 'paused', executionMode: b.executionMode };
          return paused;
        });
      }
    } else {
      activePlanRef.current = restoredPlan;
    }
    setUiMessages(record.uiMessages);
    setHistory(record.history);
  }, []);

  const retryConversationSave = useCallback(() => {
    const failed = failedSaveRef.current;
    if (!failed || failed.generation !== sessionGenerationRef.current) return;
    setCanRetryConversationSave(false);
    pendingSaveRef.current = failed;
    setConversationSaveRevision(revision => revision + 1);
  }, []);

  /** Delete all saved conversations for the current workspace. */
  const clearAllConversations = useCallback(async () => {
    const ws = workspacePathRef.current;
    if (!ws) return;
    try {
      await clearConversations(ws);
      setConversationPersistenceError(null);
    } catch (error) {
      setConversationPersistenceError(error instanceof Error ? error.message : 'Failed to clear conversations');
      throw error;
    }
  }, []);

  const enqueueEventContext = useCallback((event: EventContext) => {
    eventContextQueueRef.current.enqueue(event);
  }, []);

  return {
    uiMessages,
    isLoading,
    isWatching,
    conversationPersistenceError,
    canRetryConversationSave,
    conversationSaveRevision,
    sendMessage,
    enqueueEventContext,
    stopExecution,
    clearMessages,
    sendApproval,
    approvePlan,
    resumePlan,
    sendEditApproval,
    injectProactiveMessage,
    notifyEditorActivity,
    loadConversation,
    retryConversationSave,
    clearAllConversations,
  };
}
