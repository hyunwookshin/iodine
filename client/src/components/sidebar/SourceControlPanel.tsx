import { useState } from 'react';
import { useSourceControl } from '../../hooks/useSourceControl';
import type { GitChange, GitCommit, GitBranchInfo } from '../../hooks/useSourceControl';

// ─── helpers ─────────────────────────────────────────────────────────────────

function statusInfo(status: string): { label: string; color: string } {
  switch (status) {
    case 'M':  return { label: 'M', color: '#e9b44c' };
    case 'A':  return { label: 'A', color: '#73c991' };
    case 'D':  return { label: 'D', color: '#f44747' };
    case 'R':  return { label: 'R', color: '#569cd6' };
    case 'C':  return { label: 'C', color: '#569cd6' };
    case '??': return { label: 'U', color: '#73c991' };
    default:   return { label: status[0] ?? '?', color: '#cccccc' };
  }
}

function refStyle(ref: string): React.CSSProperties {
  if (ref === 'HEAD') return {};
  if (ref.startsWith('tag: ')) {
    return { background: 'rgba(206,145,120,0.18)', color: '#ce9178', border: '1px solid rgba(206,145,120,0.35)' };
  }
  if (ref.includes('/')) {
    return { background: 'rgba(115,201,145,0.15)', color: '#73c991', border: '1px solid rgba(115,201,145,0.3)' };
  }
  return { background: 'rgba(0,122,204,0.2)', color: '#569cd6', border: '1px solid rgba(86,156,214,0.3)' };
}

// ─── small shared widgets ─────────────────────────────────────────────────────

function IconButton({ onClick, title, disabled, children, style }: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        width: 20, height: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-text-secondary)', fontSize: 13,
        background: 'transparent', border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        borderRadius: 3, padding: 0, lineHeight: 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function SectionHeader({ open, onToggle, title, count }: {
  open: boolean; onToggle: () => void; title: string; count?: number;
}) {
  return (
    <div
      onClick={onToggle}
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
      {count !== undefined && (
        <span style={{ fontWeight: 400, marginLeft: 2 }}>({count})</span>
      )}
    </div>
  );
}

function RefBadge({ name }: { name: string }) {
  if (name === 'HEAD') return null;
  const label = name.startsWith('tag: ') ? name.slice(5) : name;
  return (
    <span style={{
      ...refStyle(name),
      fontSize: 10, padding: '1px 5px', borderRadius: 3,
      display: 'inline-block',
      maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      lineHeight: '16px',
    }}>
      {label}
    </span>
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

// ─── file change rows ─────────────────────────────────────────────────────────

function FileRow({ item, actionIcon, actionTitle, onAction, onDiscard }: {
  item: GitChange;
  actionIcon: string;
  actionTitle: string;
  onAction: (relPath: string) => void;
  onDiscard: (relPath: string, isUntracked: boolean) => void;
}) {
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
        display: 'flex', alignItems: 'center',
        padding: '2px 8px 2px 24px', gap: 6,
        background: hovered ? 'var(--color-bg-hover)' : 'transparent',
        cursor: 'default', fontSize: 13, minHeight: 22,
      }}
      title={item.relPath}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        <span style={{ color: 'var(--color-text-primary)' }}>{fileName}</span>
        {dirPart && (
          <span style={{ color: 'var(--color-text-secondary)', marginLeft: 5, fontSize: 11 }}>{dirPart}</span>
        )}
      </span>

      {hovered ? (
        <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
          <IconButton onClick={handleDiscard} title="Discard Changes">↺</IconButton>
          <IconButton
            onClick={e => { e.stopPropagation(); onAction(item.relPath); }}
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

function ChangeSection({ title, items, actionIcon, actionTitle, onAction, onDiscard }: {
  title: string; items: GitChange[];
  actionIcon: string; actionTitle: string;
  onAction: (relPath: string) => void;
  onDiscard: (relPath: string, isUntracked: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  return (
    <div>
      <SectionHeader open={open} onToggle={() => setOpen(v => !v)} title={title} count={items.length} />
      {open && items.map(item => (
        <FileRow
          key={item.relPath} item={item}
          actionIcon={actionIcon} actionTitle={actionTitle}
          onAction={onAction} onDiscard={onDiscard}
        />
      ))}
    </div>
  );
}

// ─── branch rows ──────────────────────────────────────────────────────────────

function BranchRow({ name, isCurrent, upstream, onClick }: {
  name: string; isCurrent: boolean; upstream?: string | null;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const clickable = !!onClick && !isCurrent;
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={clickable ? onClick : undefined}
      title={clickable ? `Switch to '${name}'` : name}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '3px 8px 3px 24px',
        cursor: clickable ? 'pointer' : 'default',
        background: hovered && clickable ? 'var(--color-bg-hover)' : 'transparent',
        fontSize: 13, minHeight: 22,
      }}
    >
      <span style={{
        fontSize: 9, width: 10, textAlign: 'center', flexShrink: 0,
        color: isCurrent ? 'var(--color-accent)' : 'transparent',
      }}>●</span>
      <span style={{
        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: isCurrent ? 'var(--color-text-active)' : 'var(--color-text-primary)',
        fontWeight: isCurrent ? 600 : 400,
      }}>
        {name}
      </span>
      {upstream && (
        <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', flexShrink: 0 }}>
          {upstream}
        </span>
      )}
    </div>
  );
}

function LocalBranchesSection({ branches, onCheckout }: {
  branches: GitBranchInfo[]; onCheckout: (name: string) => void;
}) {
  const [open, setOpen] = useState(true);
  if (branches.length === 0) return null;
  return (
    <div>
      <SectionHeader open={open} onToggle={() => setOpen(v => !v)} title="Local Branches" count={branches.length} />
      {open && branches.map(b => (
        <BranchRow
          key={b.name} name={b.name} isCurrent={b.isCurrent}
          upstream={b.upstream}
          onClick={b.isCurrent ? undefined : () => onCheckout(b.name)}
        />
      ))}
    </div>
  );
}

function RemoteBranchesSection({ branches, onCheckout }: {
  branches: { name: string; shortHash: string }[];
  onCheckout: (name: string) => void;
}) {
  const [open, setOpen] = useState(false); // collapsed by default
  if (branches.length === 0) return null;
  return (
    <div>
      <SectionHeader open={open} onToggle={() => setOpen(v => !v)} title="Remote Branches" count={branches.length} />
      {open && branches.map(b => {
        // strip "origin/" prefix to get local branch name for checkout
        const localName = b.name.split('/').slice(1).join('/');
        return (
          <BranchRow
            key={b.name} name={b.name} isCurrent={false}
            onClick={localName ? () => onCheckout(localName) : undefined}
          />
        );
      })}
    </div>
  );
}

// ─── commit history ───────────────────────────────────────────────────────────

function CommitRow({ commit, onCheckout }: {
  commit: GitCommit;
  onCheckout: (hash: string, shortHash: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isHead = commit.refs.includes('HEAD');
  const displayRefs = commit.refs.filter(r => r !== 'HEAD');
  const clickable = !isHead;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={clickable ? () => onCheckout(commit.hash, commit.shortHash) : undefined}
      title={clickable ? `Checkout commit ${commit.shortHash}` : 'Current HEAD'}
      style={{
        padding: '5px 8px 5px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        cursor: clickable ? 'pointer' : 'default',
        background: hovered && clickable ? 'var(--color-bg-hover)' : 'transparent',
      }}
    >
      {/* hash + date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 10, flexShrink: 0,
          color: isHead ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        }}>
          {isHead ? '●' : '○'}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--color-text-secondary)', flexShrink: 0,
        }}>
          {commit.shortHash}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', flexShrink: 0 }}>
          {commit.relativeDate}
        </span>
      </div>
      {/* message */}
      <div style={{
        fontSize: 12, paddingLeft: 16, marginTop: 1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: 'var(--color-text-primary)',
      }}
        title={commit.message}
      >
        {commit.message}
      </div>
      {/* ref badges */}
      {displayRefs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, paddingLeft: 16, marginTop: 3 }}>
          {displayRefs.map(r => <RefBadge key={r} name={r} />)}
        </div>
      )}
    </div>
  );
}

function HistorySection({ commits, onCheckout }: {
  commits: GitCommit[];
  onCheckout: (hash: string, shortHash: string) => void;
}) {
  const [open, setOpen] = useState(true);
  if (commits.length === 0) return null;
  return (
    <div>
      <SectionHeader open={open} onToggle={() => setOpen(v => !v)} title="History" count={commits.length} />
      {open && commits.map(c => <CommitRow key={c.hash} commit={c} onCheckout={onCheckout} />)}
    </div>
  );
}

// ─── main panel ───────────────────────────────────────────────────────────────

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

  const pushIcon = sc.pushStatus === 'pushing' ? '…'
    : sc.pushStatus === 'success' ? '✓'
    : sc.pushStatus === 'error' ? '!'
    : '↑';

  const pushColor = sc.pushStatus === 'success' ? '#73c991'
    : sc.pushStatus === 'error' ? '#f44747'
    : 'var(--color-text-secondary)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── header ── */}
      <div style={{
        height: 'var(--sidebar-header-height)',
        display: 'flex', alignItems: 'center',
        padding: '0 12px', borderBottom: '1px solid var(--color-border)',
        flexShrink: 0, gap: 6,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', flex: 1,
        }}>
          Source Control
        </span>
        {sc.branch && (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-secondary)' }}>
              <BranchSvg />
              {sc.branch}
            </span>
            <IconButton
              onClick={() => sc.push()}
              title={
                sc.pushStatus === 'error' ? `Push failed: ${sc.pushError}`
                : sc.pushStatus === 'success' ? 'Pushed!'
                : 'Push to remote (origin HEAD)'
              }
              disabled={sc.pushStatus === 'pushing'}
              style={{ color: pushColor, fontSize: 15, width: 22, height: 22 }}
            >
              {pushIcon}
            </IconButton>
          </>
        )}
      </div>

      {/* ── body ── */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {!workspacePath ? (
          <EmptyState>Open a folder to use source control.</EmptyState>
        ) : !sc.loaded ? (
          <EmptyState>Loading…</EmptyState>
        ) : !sc.branch ? (
          <EmptyState>Not a git repository.</EmptyState>
        ) : (
          <>
            {/* commit area */}
            <div style={{ padding: '8px 8px 0', flexShrink: 0 }}>
              <textarea
                value={sc.commitMessage}
                onChange={e => sc.setCommitMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message (Ctrl+Enter to commit)"
                rows={3}
                style={{
                  width: '100%', background: 'var(--color-bg-workbench)',
                  border: '1px solid var(--color-border)', borderRadius: 4,
                  color: 'var(--color-text-primary)', fontSize: 12,
                  padding: '6px 8px', resize: 'vertical', boxSizing: 'border-box',
                  fontFamily: 'var(--font-ui)', outline: 'none',
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
                      background: 'var(--color-bg-hover)', color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border)', borderRadius: 4,
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    Stage All
                  </button>
                )}
              </div>
            </div>

            {/* working tree changes */}
            <div style={{ marginTop: 8 }}>
              {!hasChanges && (
                <div style={{ padding: '4px 16px 8px', color: 'var(--color-text-secondary)', fontSize: 12 }}>
                  No changes in working tree.
                </div>
              )}
              <ChangeSection
                title="Staged Changes" items={sc.staged}
                actionIcon="−" actionTitle="Unstage Changes"
                onAction={sc.unstage}
                onDiscard={relPath => sc.discard(relPath, false)}
              />
              <ChangeSection
                title="Changes" items={sc.unstaged}
                actionIcon="+" actionTitle="Stage Changes"
                onAction={sc.stage}
                onDiscard={(relPath, isUntracked) => sc.discard(relPath, isUntracked)}
              />
            </div>

            {/* divider */}
            <div style={{ height: 1, background: 'var(--color-border)', margin: '8px 0 0' }} />

            {/* branch tree */}
            <div style={{ marginTop: 4 }}>
              <LocalBranchesSection branches={sc.localBranches} onCheckout={sc.checkout} />
              <RemoteBranchesSection branches={sc.remoteBranches} onCheckout={sc.checkout} />
            </div>

            {/* commit history */}
            <div style={{ marginTop: 4 }}>
              <HistorySection commits={sc.commits} onCheckout={sc.checkoutCommit} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BranchSvg() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM6 15a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm12-11a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
      <path d="M6 8v8M18 8v2a4 4 0 0 1-4 4H9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
