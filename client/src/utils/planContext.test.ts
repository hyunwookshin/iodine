import { describe, expect, it } from 'vitest';
import { formatPlanState, isPlanActive, latestPlanFromMessages, type ActivePlan } from './planContext';
import type { UIMessage } from '../types';

function plan(overrides: Partial<ActivePlan> = {}): ActivePlan {
  return {
    id: 'plan-1',
    title: 'Add planning mode',
    steps: [
      { text: 'Server contract', done: true, summary: 'Added flags to route' },
      { text: 'Tool gating', done: false },
      { text: 'UI blocks', done: false },
    ],
    status: 'executing',
    ...overrides,
  };
}

describe('isPlanActive', () => {
  it('is false for null and for proposed/completed plans', () => {
    expect(isPlanActive(null)).toBe(false);
    expect(isPlanActive(plan({ status: 'proposed' }))).toBe(false);
    expect(isPlanActive(plan({ status: 'completed' }))).toBe(false);
  });

  it('is true while approved, executing or paused', () => {
    expect(isPlanActive(plan({ status: 'approved' }))).toBe(true);
    expect(isPlanActive(plan({ status: 'executing' }))).toBe(true);
    expect(isPlanActive(plan({ status: 'paused' }))).toBe(true);
  });
});

describe('formatPlanState', () => {
  it('lists completed steps with summaries and pending steps with numbers', () => {
    const text = formatPlanState(plan());
    expect(text).toContain('<PlanState title="Add planning mode" status="executing">');
    expect(text).toContain('1. Server contract — Added flags to route');
    expect(text).toContain('2. Tool gating');
    expect(text).toContain('3. UI blocks');
    expect(text.indexOf('Completed')).toBeLessThan(text.indexOf('Pending'));
    expect(text).toContain('Resume from the first pending step');
  });

  it('escapes double quotes in the title attribute', () => {
    const text = formatPlanState(plan({ title: 'Fix "bug"' }));
    expect(text).toContain('<PlanState title="Fix \'bug\'"');
  });

  it('reports completion when no pending steps remain', () => {
    const text = formatPlanState(plan({
      steps: [{ text: 'Only step', done: true, summary: 'did it' }],
      status: 'completed',
    }));
    expect(text).toContain('All steps are completed.');
    expect(text).not.toContain('Pending');
  });

  it('marks manual edit approval mode', () => {
    const text = formatPlanState(plan({ executionMode: 'manual' }));
    expect(text).toContain('editApproval="manual"');
  });
});

describe('latestPlanFromMessages', () => {
  it('returns null when no plan block exists', () => {
    const messages: UIMessage[] = [
      { id: 'a', role: 'user', content: 'hi', timestamp: 0 },
      { id: 'b', role: 'assistant', blocks: [{ type: 'text', content: 'hello' }], isStreaming: false, timestamp: 1 },
    ];
    expect(latestPlanFromMessages(messages)).toBeNull();
  });

  it('returns the most recent plan block as an active plan snapshot', () => {
    const messages: UIMessage[] = [
      { id: 'b1', role: 'assistant', blocks: [{
        type: 'plan', id: 'old', title: 'Old', status: 'completed',
        steps: [{ text: 's', done: true }],
      }], isStreaming: false, timestamp: 1 },
      { id: 'b2', role: 'assistant', blocks: [
        { type: 'text', content: 'working on it' },
        { type: 'plan', id: 'new', title: 'New', status: 'paused', executionMode: 'manual',
          steps: [{ text: 'a', done: true }, { text: 'b', done: false }] },
      ], isStreaming: false, timestamp: 2 },
    ];
    const found = latestPlanFromMessages(messages);
    expect(found).toEqual({
      id: 'new',
      title: 'New',
      status: 'paused',
      executionMode: 'manual',
      steps: [{ text: 'a', done: true }, { text: 'b', done: false }],
    });
  });
});
