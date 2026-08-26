const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

export interface RevertEditResult {
  outcome: 'stale' | 'reverted' | 'deleted';
  path: string;
}

export async function revertAgentEdit(toolCallId: string, force = false): Promise<RevertEditResult> {
  const res = await fetch(`${API_BASE}/api/agent/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolCallId, force }),
  });
  const data = await res.json() as RevertEditResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Revert failed');
  return data;
}
