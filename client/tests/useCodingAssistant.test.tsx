import React, { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '../src/providers';
import { useCodingAssistant } from '../src/hooks/useCodingAssistant';
import type { ConversationRecord } from '../src/api/conversations';

function chatResponse(text = 'answer') {
  const body = `event: text_delta\ndata: ${JSON.stringify({ text })}\n\nevent: done\ndata: {}\n\n`;
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function toolChatResponse() {
  const events = [
    ['tool_call', { id: 'tool-1', name: 'read_file', input: { path: 'README.md' } }],
    ['command_approval', { id: 'approval-1', command: 'npm test', reason: 'Run tests', cwd: null, longRunning: false }],
    ['text_delta', { text: 'answer' }],
    ['done', {}],
  ];
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

function createFetchMock(options: { saveStatuses?: number[] } = {}) {
  const saves: Array<{ workspacePath: string; id: string; history: unknown[]; uiMessages: unknown[] }> = [];
  const chats: Array<{ messages: unknown[]; workspace: string | null }> = [];
  const saveStatuses = [...(options.saveStatuses ?? [200])];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/agent/chat')) {
      const body = JSON.parse(String(init?.body));
      chats.push({ messages: body.messages, workspace: body.activeFile ?? null });
      return chatResponse();
    }
    if (url.includes('/api/conversations') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      saves.push(body);
      return new Response('', { status: saveStatuses.shift() ?? 200 });
    }
    if (url.includes('/api/conversations') && init?.method === 'DELETE') return new Response('', { status: 200 });
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, saves, chats };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useCodingAssistant conversation persistence', () => {
  it('saves a completed turn once under StrictMode', async () => {
    const { saves } = createFetchMock();
    const { result } = renderHook(() => useCodingAssistant(DEFAULT_PROVIDER, DEFAULT_MODEL, 'workspace-a'), { wrapper });

    await act(async () => { await result.current.sendMessage('hello'); });
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].workspacePath).toBe('workspace-a');
    expect(saves[0].history).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'answer' },
    ]);
    expect(saves[0].uiMessages).toHaveLength(2);
  });

  it('restores a conversation and continues it with the same ID and history', async () => {
    const { saves, chats } = createFetchMock();
    const { result } = renderHook(() => useCodingAssistant(DEFAULT_PROVIDER, DEFAULT_MODEL, 'workspace-a'), { wrapper });
    const saved: ConversationRecord = {
      id: 'legacy-session-1',
      timestamp: 1,
      history: [{ role: 'user', content: 'previous' }, { role: 'assistant', content: 'old answer' }],
      uiMessages: [
        { id: 'u1', role: 'user', content: 'previous', timestamp: 1 },
        { id: 'a1', role: 'assistant', blocks: [{ type: 'text', content: 'old answer' }], isStreaming: false, timestamp: 2 },
      ],
    };

    act(() => result.current.loadConversation(saved));
    await act(async () => { await result.current.sendMessage('continue'); });
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].id).toBe('legacy-session-1');
    expect(chats[0].messages).toEqual([
      { role: 'user', content: 'previous' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'continue' },
    ]);
  });

  it('normalizes transient tool and approval state before saving', async () => {
    const saves: Array<{ uiMessages: Array<{ role: string; blocks?: Array<Record<string, unknown>> }> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/agent/chat')) return toolChatResponse();
      if (url.includes('/api/conversations') && init?.method === 'POST') {
        saves.push(JSON.parse(String(init.body)));
        return new Response('', { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
    const { result } = renderHook(() => useCodingAssistant(DEFAULT_PROVIDER, DEFAULT_MODEL, 'workspace-a'), { wrapper });

    await act(async () => { await result.current.sendMessage('run it'); });
    await waitFor(() => expect(saves).toHaveLength(1));
    const blocks = saves[0].uiMessages.find(message => message.role === 'assistant')?.blocks!;
    expect(blocks.find(block => block.type === 'tool')?.pending).toBe(false);
    expect(blocks.find(block => block.type === 'command-approval')?.status).toBe('rejected');
  });

  it('does not let a late workspace-A response save into workspace B', async () => {
    let resolveChat!: (response: Response) => void;
    const deferred = new Promise<Response>(resolve => { resolveChat = resolve; });
    const saves: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/agent/chat')) return deferred;
      if (url.includes('/api/conversations') && init?.method === 'POST') { saves.push(JSON.parse(String(init.body))); return new Response('', { status: 200 }); }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ workspacePath }) => useCodingAssistant(DEFAULT_PROVIDER, DEFAULT_MODEL, workspacePath), {
      initialProps: { workspacePath: 'workspace-a' },
      wrapper,
    });

    let pending!: Promise<void>;
    act(() => { pending = result.current.sendMessage('from A'); });
    rerender({ workspacePath: 'workspace-b' });
    resolveChat(chatResponse('late A'));
    await act(async () => { await pending; });
    expect(saves).toHaveLength(0);
    expect(result.current.uiMessages).toEqual([]);
  });

  it('exposes a failed save and retries it successfully', async () => {
    const { saves } = createFetchMock({ saveStatuses: [500, 200] });
    const { result } = renderHook(() => useCodingAssistant(DEFAULT_PROVIDER, DEFAULT_MODEL, 'workspace-a'), { wrapper });
    await act(async () => { await result.current.sendMessage('hello'); });
    await waitFor(() => expect(result.current.canRetryConversationSave).toBe(true));
    expect(result.current.conversationPersistenceError).toContain('HTTP 500');

    act(() => result.current.retryConversationSave());
    await waitFor(() => expect(result.current.conversationPersistenceError).toBeNull());
    expect(saves).toHaveLength(2);
  });
});
