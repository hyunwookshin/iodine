// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '../src/providers';
import { useCodingAssistant } from '../src/hooks/useCodingAssistant';
import type { UIBlock } from '../src/types';

type PlanBlock = UIBlock & { type: 'plan' };

function sseResponse(body: string) {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const DONE_EVENT = 'event: done\ndata: {}\n\n';

function chatResponse(...extraEvents: string[]) {
  return sseResponse([...extraEvents, DONE_EVENT].join(''));
}

function planEvent() {
  const payload = { title: 'Add auth', steps: ['Write middleware', 'Wire routes', 'Run typecheck'] };
  return `event: plan\ndata: ${JSON.stringify(payload)}\n\n`;
}

function planUpdateEvent(index: number, summary: string) {
  return `event: plan_update\ndata: ${JSON.stringify({ index, status: 'done', summary })}\n\n`;
}

function findPlan(uiMessages: ReturnType<typeof useCodingAssistant>['uiMessages']): PlanBlock {
  for (const msg of uiMessages) {
    if (msg.role !== 'assistant') continue;
    for (const block of msg.blocks) {
      if (block.type === 'plan') return block;
    }
  }
  throw new Error('plan block not found');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useCodingAssistant planning mode', () => {
  it('passes planningMode in the request body and renders a proposed plan card', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return chatResponse(planEvent());
    }));
    const { result } = renderHook(() => useCodingAssistant(DEFAULT_PROVIDER, DEFAULT_MODEL, null));

    await act(async () => { await result.current.sendMessage('Plan a feature', undefined, undefined, undefined, undefined, false, undefined, true); });

    expect(requests[0].planningMode).toBe(true);
    expect(requests[0].planActive).toBe(false);
    const planBlock = findPlan(result.current.uiMessages);
    expect(planBlock.status).toBe('proposed');
    expect(planBlock.steps.map(s => s.text)).toEqual(['Write middleware', 'Wire routes', 'Run typecheck']);
  });

  it('injects PlanState into the approval turn and flips the card to approved', async () => {
    const requests: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) return chatResponse(planEvent());
      return chatResponse();
    }));
    const { result } = renderHook(() => useCodingAssistant(DEFAULT_PROVIDER, DEFAULT_MODEL, null));

    await act(async () => { await result.current.sendMessage('Plan it', undefined, undefined, undefined, undefined, false, undefined, true); });
    const planId = findPlan(result.current.uiMessages).id;

    await act(async () => { result.current.approvePlan(planId, 'manual'); });
    await waitFor(() => expect(requests.length).toBe(2));

    const approvalRequest = requests[1] as { messages: Array<{ role: string; content: string }>; planActive: unknown; editApproval: unknown };
    const lastContent = approvalRequest.messages.at(-1)?.content ?? '';
    expect(lastContent).toContain('<PlanState title="Add auth" status="approved" editApproval="manual">');
    expect(lastContent).toContain('2. Wire routes');
    expect(approvalRequest.planActive).toBe(true);
    expect(approvalRequest.editApproval).toBe('manual');
    expect(findPlan(result.current.uiMessages).status).toBe('approved');
  });

  it('patches plan steps across messages via plan_update events', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) return chatResponse(planEvent());
      if (callCount === 2) return chatResponse(planUpdateEvent(2, 'Added auth middleware'));
      return chatResponse();
    }));
    const { result } = renderHook(() => useCodingAssistant(DEFAULT_PROVIDER, DEFAULT_MODEL, null));

    await act(async () => { await result.current.sendMessage('Plan it', undefined, undefined, undefined, undefined, false, undefined, true); });
    const planId = findPlan(result.current.uiMessages).id;

    await act(async () => { result.current.approvePlan(planId, 'auto'); });
    await waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2));
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(findPlan(result.current.uiMessages).steps[1].done).toBe(true));

    const planBlock = findPlan(result.current.uiMessages);
    expect(planBlock.status).toBe('executing');
    expect(planBlock.steps[1].summary).toBe('Added auth middleware');
    expect(planBlock.steps[0].done).toBe(false);
  });

  it('parks the plan as paused when stopped mid-execution and resumes on command', async () => {
    const requests: Array<Record<string, unknown>> = [];
    // Second request hangs until aborted, rejecting like real fetch does.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) return chatResponse(planEvent());
      if (requests.length === 2) {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          const poll = setInterval(() => {
            if (signal?.aborted) {
              clearInterval(poll);
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            }
          }, 5);
        });
      }
      return chatResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useCodingAssistant(DEFAULT_PROVIDER, DEFAULT_MODEL, null));

    await act(async () => { await result.current.sendMessage('Plan it', undefined, undefined, undefined, undefined, false, undefined, true); });
    const planId = findPlan(result.current.uiMessages).id;

    await act(async () => { result.current.approvePlan(planId, 'auto'); });
    await waitFor(() => expect(requests.length).toBe(2));
    expect(findPlan(result.current.uiMessages).status).toBe('approved');

    await act(async () => { result.current.stopExecution(); });
    await waitFor(() => expect(findPlan(result.current.uiMessages).status).toBe('paused'));

    await act(async () => { result.current.resumePlan(); });
    await waitFor(() => expect(requests.length).toBe(3));
    const resumeRequest = requests[2] as { messages: Array<{ role: string; content: string }>; planActive: unknown };
    expect(resumeRequest.messages.at(-1)?.content).toContain('<PlanState title="Add auth" status="executing">');
    expect(resumeRequest.planActive).toBe(true);
    expect(findPlan(result.current.uiMessages).status).toBe('executing');
  });

  it('renders pending edit approvals and posts the decision to the server', async () => {
    const approvalPosts: Array<{ id: string; approved: boolean }> = [];
    let callCount = 0;
    const editApprovalEvent = `event: edit_approval\ndata: ${JSON.stringify({ id: 'edit-1', op: 'edit', path: '/ws/src/a.ts', preview: 'Apply edit: /ws/src/a.ts\nnew code' })}\n\n`;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(init?.body).includes('"id":"edit-1"')) {
        approvalPosts.push(body as { id: string; approved: boolean });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      callCount += 1;
      if (callCount === 1) return chatResponse(planEvent());
      if (callCount === 2) return chatResponse(editApprovalEvent);
      return chatResponse();
    }));
    const { result } = renderHook(() => useCodingAssistant(DEFAULT_PROVIDER, DEFAULT_MODEL, null));

    await act(async () => { await result.current.sendMessage('Plan it', undefined, undefined, undefined, undefined, false, undefined, true); });
    const planId = findPlan(result.current.uiMessages).id;

    await act(async () => { result.current.approvePlan(planId, 'auto'); });
    await waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2));
    await act(async () => { await Promise.resolve(); });

    const blocks = result.current.uiMessages.flatMap(m => m.role === 'assistant' ? m.blocks : []);
    const editBlock = blocks.find((b): b is UIBlock & { type: 'edit-approval' } => b.type === 'edit-approval');
    expect(editBlock).toBeDefined();
    expect(editBlock!.status).toBe('pending');
    expect(editBlock!.path).toBe('/ws/src/a.ts');

    await act(async () => { await result.current.sendEditApproval('edit-1', true); });
    expect(approvalPosts).toEqual([{ id: 'edit-1', approved: true }]);
    expect(editBlock && (result.current.uiMessages.flatMap(m => m.role === 'assistant' ? m.blocks : []).find(b => b.type === 'edit-approval') as { status: string }).status).toBe('approved');
  });
});
