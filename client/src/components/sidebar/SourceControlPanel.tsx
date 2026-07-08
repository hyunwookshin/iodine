import { useState } from 'react';
import { useSourceControl } from '../../hooks/useSourceControl';
import type { GitChange } from '../../hooks/useSourceControl';

function statusInfo(status: string): { label: string; color: string } {
  switch (status) {
    case 'M': return { label: 'M', color: '#e9b44c' };
    case 'A': return { label: 'A', color: '#73c991' };
    case 'D': return { label: 'D', color: '#f44747' };
    case 'R': return { label: 'R', color: '#569cd6' };
    case 'C': return { label: 'C', color: '#569cd6' };
    case '??': return { label: 'U', color: '#73c991' };
    default:  return { label: status[0] ?? '?', color: '#cccccc' };
  }
}

interface FileRowProps {
  item: GitChange;
  actionIcon: string;
  actionTitle: string;
  onAction: (relPath: string) => void;
  onDiscard: (relPath: string, isUntracked: boolean) => void;
}

function FileRow({ item, actionIcon, actionTitle, onAction, onDiscard }: FileRowProps) {
  const [hovered, setHovered] = useState(false);
  const { label, color } = statusInfo(item.status);
  const parts = item.relPath.replace(/\\/g, '/').split('/');
  const fileName = parts[parts.length - 1];
  const dirPart = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

  const handleDiscard = (e: React.MouseEvent) => {
    e.stopPropagation();
    const isUntracked = item.status === '??';
    const msg = isUntracked
      ? `Delete '${item.relPath}'? This cannot be undone.`
      : `Discard changes to '${item.relPath}'?`;
    if (!window.confirm(msg)) return;
    onDiscard(item.relPath, isUntracked);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '2px 8px 2px 24px',
        gap: 6,
        background: hovered ? 'var(--color-bg-hover)' : 'transparent',
        cursor: 'default',
        fontSize: 13,
        minHeight: 22,
      }}
      title={item.relPath}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        <span style={{ color: 'var(--color-text-primary)' }}>{fileName}</span>
        {dirPart && (
          <span style={{ color: 'var(--color-text-secondary)', marginLeft: 5, fontSize: 11 }}>
            {dirPart}
          </span>
        )}
      </span>

      {hovered ? (
        <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
          <IconButton onClick={handleDiscard} title="Discard Changes">↺</IconButton>
          <IconButton
            onClick={(e) => { e.stopPropagation(); onAction(item.relPath); }}
            title={actionTitle}
          >
            {actionIcon}
          </IconButton>
        </div>
      ) : (
        <span style={{ color, fontSize: 11, fontWeight: 700, width: 14, textAlign: 'center', flexShrink: 0 }}>
          {label}
        </span>
      )}
    </div>
  );
}

function IconButton({ onClick, title, children }: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 20, height: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-text-secondary)', fontSize: 13,
        background: 'transparent', border: 'none', cursor: 'pointer',
        borderRadius: 3, padding: 0, lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

interface ChangeSectionProps {
  title: string;
  items: GitChange[];
  actionIcon: string;
  actionTitle: string;
  onAction: (relPath: string) => void;
  onDiscard: (relPath: string, isUntracked: boolean) => void;
}

function ChangeSection({ title, items, actionIcon, actionTitle, onAction, onDiscard }: ChangeSectionProps) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;

  return (
    <div>
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 8px', cursor: 'pointer',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', color: 'var(--color-text-secondary)',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 9, display: 'inline-block', width: 10 }}>
          {open ? '▾' : '▸'}
        </span>
        {title}
        <span style={{ fontWeight: 400, marginLeft: 2 }}>({items.length})</span>
      </div>

      {open && items.map(item => (
        <FileRow
          key={item.relPath}
          item={item}
          actionIcon={actionIcon}
          actionTitle={actionTitle}
          onAction={onAction}
          onDiscard={onDiscard}
        />
      ))}
    </div>
  );
}

export function SourceControlPanel({ workspacePath }: { workspacePath: string | null }) {
  const sc = useSourceControl(workspacePath);
  const canCommit = sc.staged.length > 0 && sc.commitMessage.trim().length > 0 && !sc.loading;
  const hasChanges = sc.staged.length > 0 || sc.unstaged.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canCommit) sc.commit();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Panel header */}
      <div
        style={{
          height: 'var(--sidebar-header-height)',
          display: 'flex', alignItems: 'center',
          padding: '0 12px', borderBottom: '1px solid var(--color-border)',
          flexShrink: 0, gap: 8,
        }}
      >
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', flex: 1,
        }}>
          Source Control
        </span>
        {sc.branch && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, color: 'var(--color-text-secondary)',
          }}>
            <BranchIcon />
            {sc.branch}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* No workspace */}
        {!workspacePath ? (
          <EmptyState>Open a folder to use source control.</EmptyState>
        ) : !sc.loaded ? (
          <EmptyState>Loading…</EmptyState>
        ) : !sc.branch ? (
          <EmptyState>Not a git repository.</EmptyState>
        ) : (
          <>
            {/* Commit area */}
            <div style={{ padding: '8px 8px 0', flexShrink: 0 }}>
              <textarea
                value={sc.commitMessage}
                onChange={e => sc.setCommitMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message (Ctrl+Enter to commit)"
                rows={3}
                style={{
                  width: '100%',
                  background: 'var(--color-bg-workbench)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  color: 'var(--color-text-primary)',
                  fontSize: 12,
                  padding: '6px 8px',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  fontFamily: 'var(--font-ui)',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button
                  onClick={sc.commit}
                  disabled={!canCommit}
                  style={{
                    flex: 1, padding: '5px 8px', fontSize: 12, fontWeight: 600,
                    background: canCommit ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                    color: canCommit ? '#fff' : 'var(--color-text-secondary)',
                    border: 'none', borderRadius: 4,
                    cursor: canCommit ? 'pointer' : 'default',
                  }}
                >
                  {sc.loading ? 'Committing…' : 'Commit'}
                </button>
                {sc.unstaged.length > 0 && (
                  <button
                    onClick={sc.stageAllChanges}
                    title="Stage all changes"
                    style={{
                      padding: '5px 10px', fontSize: 12,
                      background: 'var(--color-bg-hover)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    Stage All
                  </button>
                )}
              </div>
            </div>

            {/* File lists */}
            <div style={{ marginTop: 8 }}>
              {!hasChanges ? (
                <div style={{
                  padding: '12px 16px',
                  color: 'var(--color-text-secondary)', fontSize: 12, textAlign: 'center',
                }}>
                  No changes in working tree.
                </div>
              ) : (
                <>
                  <ChangeSection
                    title="Staged Changes"
                    items={sc.staged}
                    actionIcon="−"
                    actionTitle="Unstage Changes"
                    onAction={sc.unstage}
                    onDiscard={(relPath) => sc.discard(relPath, false)}
                  />
                  <ChangeSection
                    title="Changes"
                    items={sc.unstaged}
                    actionIcon="+"
                    actionTitle="Stage Changes"
                    onAction={sc.stage}
                    onDiscard={(relPath, isUntracked) => sc.discard(relPath, isUntracked)}
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--color-text-secondary)', fontSize: 12,
      padding: '0 16px', textAlign: 'center',
    }}>
      {children}
    </div>
  );
}

function BranchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM6 15a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm12-11a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
      <path d="M6 8v8M18 8v2a4 4 0 0 1-4 4H9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
