import { useState } from 'react';
import { revertAgentEdit } from '../../api/agent';

type State = 'idle' | 'reverting' | 'reverted';

const buttonStyle: React.CSSProperties = {
  background: 'var(--color-bg-subtler)',
  border: '1px solid var(--color-border)',
  borderRadius: 999,
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontSize: 10,
  padding: '3px 10px',
};

export function RevertButton({ toolCallId, onReverted }: { toolCallId: string; onReverted: (path: string) => void }) {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);

  const run = async (force: boolean) => {
    setState('reverting');
    setError(null);
    try {
      const result = await revertAgentEdit(toolCallId, force);
      if (result.outcome === 'stale') {
        setState('idle');
        if (window.confirm('This file changed after the edit. Revert anyway and discard those changes?')) await run(true);
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

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button type="button" disabled={state === 'reverting'} onClick={() => run(false)} style={buttonStyle}>
        {state === 'reverting' ? 'Reverting…' : 'Revert'}
      </button>
      {error && <span style={{ fontSize: 10, color: '#f48771' }}>{error}</span>}
    </span>
  );
}
