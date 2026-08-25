import type { UIBlock } from '../../types';

type PlanBlockModel = UIBlock & { type: 'plan' };

const STATUS_META: Record<PlanBlockModel['status'], { label: string; color: string }> = {
  proposed: { label: 'awaiting review', color: '#4fc1ff' },
  approved: { label: 'approved', color: '#4fc1ff' },
  executing: { label: 'executing…', color: '#e7c547' },
  paused: { label: 'paused', color: '#e7c547' },
  completed: { label: 'completed', color: '#4ec9b0' },
};

export function PlanBlock({ block, onApprove, onResume, onFeedback }: {
  block: PlanBlockModel;
  onApprove: (executionMode: 'auto' | 'manual') => void;
  onResume: () => void;
  onFeedback: () => void;
}) {
  const meta = STATUS_META[block.status];
  const doneCount = block.steps.filter(s => s.done).length;
  const pending = block.status === 'proposed';
  const resumable = block.status === 'paused';
  const running = block.status === 'executing';

  return (
    <div style={{ background: 'var(--color-bg-subtle)', border: `1px solid ${meta.color}40`, borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 11px', background: 'var(--color-bg-subtler)', borderBottom: '1px solid var(--color-border)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, minWidth: 0 }}>
          <span>🗒</span>
          <span style={{ fontWeight: 600 }}>Plan</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-primary)' }}>{block.title}</span>
        </span>
        <span style={{ fontSize: 10, color: meta.color, background: `${meta.color}20`, border: `1px solid ${meta.color}40`, borderRadius: 999, padding: '2px 7px', flexShrink: 0 }}>
          {pending ? meta.label : `${doneCount}/${block.steps.length}${running ? ' · ' + meta.label : ''}`}
        </span>
      </div>
      {!pending && block.executionMode === 'manual' && (
        <div style={{ padding: '5px 11px 0', fontSize: 10, color: 'var(--color-text-secondary)' }}>Review each edit before it applies</div>
      )}
      <ol style={{ margin: 0, padding: '7px 11px 9px 27px', fontSize: 12, color: 'var(--color-text-primary)', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {block.steps.map((step, i) => (
          <li key={i} style={{ lineHeight: 1.45 }}>
            <span style={{ textDecoration: step.done ? 'line-through' : 'none', opacity: step.done ? 0.65 : 1 }}>{step.text}</span>
            {step.summary && (
              <div style={{ marginTop: 2, fontSize: 10, color: '#4ec9b0', fontStyle: 'italic' }}>{step.summary}</div>
            )}
          </li>
        ))}
      </ol>
      {pending && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 11px 10px' }}>
          <button onClick={() => onApprove('auto')} title="Approve and execute without per-edit confirmation" style={{ background: '#0e3a5c', border: '1px solid #4fc1ff60', borderRadius: 999, color: '#4fc1ff', fontSize: 11, padding: '5px 13px', cursor: 'pointer', fontWeight: 600 }}>✓ Approve &amp; Execute</button>
          <button onClick={() => onApprove('manual')} title="Approve, but confirm every file change before it applies" style={{ background: 'none', border: '1px solid #4fc1ff60', borderRadius: 999, color: '#4fc1ff', fontSize: 11, padding: '5px 13px', cursor: 'pointer' }}>Review Each Edit</button>
          <button onClick={onFeedback} title="Keep planning and suggest changes to the plan" style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 999, color: 'var(--color-text-secondary)', fontSize: 11, padding: '5px 13px', cursor: 'pointer' }}>Give Feedback</button>
        </div>
      )}
      {resumable && (
        <div style={{ padding: '0 11px 10px' }}>
          <button onClick={onResume} style={{ background: '#3a2e0e', border: '1px solid #e7c54760', borderRadius: 999, color: '#e7c547', fontSize: 11, padding: '5px 13px', cursor: 'pointer', fontWeight: 600 }}>▶ Resume Execution</button>
        </div>
      )}
    </div>
  );
}
