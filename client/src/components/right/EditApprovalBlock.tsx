import type { UIBlock } from '../../types';

type EditApprovalBlockModel = UIBlock & { type: 'edit-approval' };

const STATUS_META: Record<EditApprovalBlockModel['status'], { label: string; color: string }> = {
  pending: { label: 'waiting for approval', color: '#e7c547' },
  approved: { label: 'applied', color: '#4ec9b0' },
  rejected: { label: 'skipped', color: '#f48771' },
};

export function EditApprovalBlock({ block, onApprove, onReject }: {
  block: EditApprovalBlockModel;
  onApprove: () => void;
  onReject: () => void;
}) {
  const meta = STATUS_META[block.status];
  const isPending = block.status === 'pending';
  return (
    <div style={{ background: 'var(--color-bg-subtle)', border: `1px solid ${meta.color}40`, borderRadius: 6, marginBottom: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--color-bg-subtler)', borderBottom: '1px solid var(--color-border)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <span>📝</span>
          <span style={{ fontWeight: 600 }}>File change</span>
        </span>
        <span style={{ fontSize: 10, color: meta.color, background: `${meta.color}20`, border: `1px solid ${meta.color}40`, borderRadius: 999, padding: '2px 7px' }}>{meta.label}</span>
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: 11, marginBottom: 5 }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>{block.op === 'write' ? 'Create' : 'Edit'}:</span>{' '}
          <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{block.path}</span>
        </div>
        {block.preview && (
          <pre style={{ margin: '0 0 6px', padding: '7px 9px', maxHeight: 180, overflowY: 'auto', background: 'var(--color-bg-editor)', border: '1px solid var(--color-border)', borderRadius: 5, fontSize: 10, fontFamily: 'monospace', color: 'var(--color-code-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{block.preview}</pre>
        )}
        {isPending && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button onClick={onApprove} style={{ background: '#1e4a1e', border: '1px solid #4ec9b060', borderRadius: 999, color: '#4ec9b0', fontSize: 11, padding: '5px 13px', cursor: 'pointer', fontWeight: 600 }}>✓ Apply</button>
            <button onClick={onReject} style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 999, color: 'var(--color-text-secondary)', fontSize: 11, padding: '5px 13px', cursor: 'pointer' }}>✕ Skip</button>
          </div>
        )}
      </div>
    </div>
  );
}
