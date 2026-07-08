import { useState, useCallback } from 'react';
import { UIMessage, UIBlock, HistoryMessage } from '../types';
import { PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODEL } from '../providers';

function uid() {
  return Math.random().toString(36).slice(2);
}

// Go directly to the Express server for SSE requests rather than through the Vite proxy.
// Vite's dev proxy (http-proxy) closes its connection to the backend shortly after
// forwarding the first SSE chunk — the browser's stream stays open on Vite's side but
// the Express res.on('close') fires, so the agent loop aborts before calling the API.
// Express already has CORS configured for localhost:5173, so cross-origin works fine.
// Non-streaming endpoints (/api/files/*, /api/agent/status) still go through the proxy.
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

export function useCodingAssistant() {
  const [uiMessages, setUiMessages] = useState<UIMessage[]>([]);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [provider, setProviderState] = useState(DEFAULT_PROVIDER);
  const [model, setModelState] = useState<string>(DEFAULT_MODEL);

  const setProvider = useCallback((providerId: string) => {
    const p = PROVIDERS.find(p => p.id === providerId) ?? DEFAULT_PROVIDER;
    setProviderState(p);
    setModelState(p.models[0].id); // reset to first model of new provider
  }, []);

  const setModel = useCallback((modelId: string) => {
    setModelState(modelId);
  }, []);

  const sendMessage = useCallback(async (text: string, activeFilePath?: string | null) => {
    if (!text.trim() || isLoading) return;

    const userMsg: UIMessage = { id: uid(), role: 'user', content: text };
    const assistantId = uid();
    const assistantMsg: UIMessage = { id: assistantId, role: 'assistant', blocks: [], isStreaming: true };

    const newHistory: HistoryMessage[] = [...history, { role: 'user', content: text }];

    setUiMessages(prev => [...prev, userMsg, assistantMsg]);
    setHistory(newHistory);
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newHistory, model, provider: provider.id, activeFile: activeFilePath ?? null }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const updateAssistant = (updater: (msg: UIMessage & { role: 'assistant' }) => UIMessage) => {
        setUiMessages(prev => prev.map(m =>
          m.id === assistantId && m.role === 'assistant'
            ? updater(m as UIMessage & { role: 'assistant' })
            : m
        ));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

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
          try {
            payload = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (eventName === 'text_delta') {
            const text = payload.text as string;
            updateAssistant(msg => {
              const blocks = [...msg.blocks];
              const last = blocks[blocks.length - 1];
              if (last && last.type === 'text') {
                blocks[blocks.length - 1] = { type: 'text', content: last.content + text };
              } else {
                blocks.push({ type: 'text', content: text });
              }
              return { ...msg, blocks };
            });
          } else if (eventName === 'tool_call') {
            const toolBlock: UIBlock = {
              type: 'tool',
              id: payload.id as string,
              name: payload.name as string,
              input: payload.input as Record<string, unknown>,
              pending: true,
            };
            updateAssistant(msg => ({ ...msg, blocks: [...msg.blocks, toolBlock] }));
          } else if (eventName === 'tool_result') {
            const toolUseId = payload.tool_use_id as string;
            updateAssistant(msg => ({
              ...msg,
              blocks: msg.blocks.map(b =>
                b.type === 'tool' && b.id === toolUseId
                  ? { ...b, result: payload.preview as string, error: payload.error as boolean, pending: false }
                  : b
              ),
            }));
          } else if (eventName === 'done') {
            updateAssistant(msg => {
              const finalText = msg.blocks
                .filter((b): b is UIBlock & { type: 'text' } => b.type === 'text')
                .map(b => b.content)
                .join('');
              setHistory(h => [...h, { role: 'assistant', content: finalText }]);
              return { ...msg, isStreaming: false };
            });
          } else if (eventName === 'error') {
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
      const errText = err instanceof Error ? err.message : 'Unknown error';
      setUiMessages(prev => prev.map(m =>
        m.id === assistantId && m.role === 'assistant'
          ? { ...m, isStreaming: false, blocks: [...(m as UIMessage & { role: 'assistant' }).blocks, { type: 'text', content: `Error: ${errText}` }] }
          : m
      ));
    } finally {
      setIsLoading(false);
    }
  }, [history, isLoading, model, provider]);

  const clearMessages = useCallback(() => {
    setUiMessages([]);
    setHistory([]);
  }, []);

  return { uiMessages, isLoading, provider, setProvider, model, setModel, sendMessage, clearMessages };
}
