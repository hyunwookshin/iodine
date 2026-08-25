import type { PlanStep, UIMessage } from '../types';

export interface ActivePlan {
  id: string;
  title: string;
  steps: PlanStep[];
  status: 'proposed' | 'approved' | 'executing' | 'paused' | 'completed';
  executionMode?: 'auto' | 'manual';
}

/** True while a plan still needs work — drives <PlanState> injection into requests. */
export function isPlanActive(plan: ActivePlan | null | undefined): boolean {
  return !!plan && plan.status !== 'completed' && plan.status !== 'proposed';
}

/**
 * Formats the durable execution memory injected invisibly into every request
 * while a plan is being executed, so the model always knows which phase it is
 * in, which steps are done, what changed per step, and what remains.
 */
export function formatPlanState(plan: ActivePlan): string {
  const lines: string[] = [];
  const mode = plan.executionMode === 'manual' ? ' editApproval="manual"' : '';
  lines.push(`<PlanState title="${plan.title.replace(/"/g, "'")}" status="${plan.status}"${mode}>`);
  const done = plan.steps.filter(s => s.done);
  const pending = plan.steps.filter(s => !s.done);
  if (done.length > 0) {
    lines.push('Completed steps:');
    done.forEach((s, i) => lines.push(`${i + 1}. ${s.text}${s.summary ? ` — ${s.summary}` : ''}`));
  }
  if (pending.length > 0) {
    lines.push('Pending steps:');
    pending.forEach(s => {
      const n = plan.steps.indexOf(s) + 1;
      lines.push(`${n}. ${s.text}`);
    });
    lines.push('Resume from the first pending step when the user asks to continue.');
  } else {
    lines.push('All steps are completed.');
  }
  lines.push('</PlanState>');
  return lines.join('\n');
}

/** Finds the most recent plan block in persisted UI messages (restore on reload). */
export function latestPlanFromMessages(messages: UIMessage[]): ActivePlan | null {
  let found: ActivePlan | null = null;
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    for (const block of msg.blocks) {
      if (block.type === 'plan') {
        found = { id: block.id, title: block.title, steps: block.steps.map(s => ({ ...s })), status: block.status, executionMode: block.executionMode };
      }
    }
  }
  return found;
}
