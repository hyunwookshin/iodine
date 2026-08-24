import { useState } from 'react';
import { revertAgentEdit } from '../../api/agent';

type State = 'idle' | 'reverting' | 'stale' | 'reverted';

const buttonStyle: React.CSSProperties = {
  background: 'var(--color-bg-subtler)',
  border: '1px solid var(--color-border)',
  borderRadius: 999,
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontSize: 10,
  padding: '3px 10px',
};

const dangerStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#4a1e1e',
  border: '1px solid #f4877160',
  color: '#f48771',
  fontWeight: 600,
};

export function RevertButton({ toolCallId, onReverted }: { toolCallId: string; onReverted: (path: string) => void }) {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [stalePath, setStalePath] = useState<string | null>(null);

  const run = async (force: boolean) => {
    setState('reverting');
    setError(null);
    try {
      const result = await revertAgentEdit(toolCallId, force);
      if (result.outcome === 'stale') {
        setStalePath(result.path);
        setState('stale');
        return;
      }
      setState('reverted');
      onReverted(result.path);
    } catch (err) {
      setState('idle');
      setError(err instanceof Error ? err.message : 'Revert failed');
    }
  };

  if (state === 'reverted') return <span style={{ fontSize: 10, color: '#4ec9b0' }}>Reverted</span>;

  if (state === 'stale') {
    const name = stalePath?.split('/').pop() ?? 'This file';
    return (
      <div style={{ background: '#e7c54710', border: '1px solid #e7c54760', borderRadius: 5, padding: '7px 9px' }}>
        <div style={{ fontSize: 10, color: 'var(--color-text-primary)', marginBottom: 6 }}>
          {name} changed after this edit. Reverting discards those changes.
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={() => run(true)} style={dangerStyle}>Revert anyway</button>
          <button type="button" onClick={() => setState('idle')} style={buttonStyle}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button type="button" disabled={state === 'reverting'} onClick={() => run(false)} style={buttonStyle}>
        {state === 'reverting' ? 'Reverting…' : 'Revert'}
      </button>
      {error && <span style={{ fontSize: 10, color: '#f48771' }}>{error}</span>}
    </span>
  );
}
