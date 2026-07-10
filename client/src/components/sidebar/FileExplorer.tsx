import { useState, useMemo } from 'react';
import { useFileTree } from '../../hooks/useFileTree';
import { useGitStatus } from '../../hooks/useGitStatus';
import { FileTreeNode } from './FileTreeNode';
import { openWorkspace, deleteNode } from '../../api/files';
import type { FileNode } from '../../types';
import type { GitFileStatus } from '../../hooks/useGitStatus';

interface FileExplorerProps {
  workspacePath: string | null;
  activeFilePath: string | null;
  onWorkspaceOpen: (path: string) => void;
  onFileClick: (node: FileNode) => void;
  onDeleteSuccess: (deletedPath: string) => void;
  localTree?: FileNode | null;
}

// Merge two GitFileStatus values into a single representative value for a directory.
function mergeStatus(a: GitFileStatus | undefined, b: GitFileStatus): GitFileStatus {
  if (!a) return b;
  if (a === 'both' || b === 'both') return 'both';
  if (a !== b) return 'both';
  return a;
}

// Computes directory statuses so that parents inherit the styling of their children.
function aggregateGitStatus(statusMap: Record<string, GitFileStatus>): Record<string, GitFileStatus> {
  const result: Record<string, GitFileStatus> = { ...statusMap };
  for (const [path, status] of Object.entries(statusMap)) {
    const segments = path.split('/');
    // Build every ancestor directory path (excluding the file itself)
    for (let i = 1; i < segments.length; i++) {
      const dirPath = segments.slice(0, i).join('/');
      result[dirPath] = mergeStatus(result[dirPath], status);
    }
  }
  return result;
}

export function FileExplorer({
  workspacePath,
  activeFilePath,
  onWorkspaceOpen,
  onFileClick,
  onDeleteSuccess,
  localTree,
}: FileExplorerProps) {
  const { tree, expandedPaths, toggleExpand, loading, error, refetch } = useFileTree(workspacePath, localTree);
  const rawGitStatus = useGitStatus(workspacePath);

  // Memoise aggregated status to avoid unnecessary recalculations.
  const gitStatus = useMemo(() => aggregateGitStatus(rawGitStatus), [rawGitStatus]);

  const [inputPath, setInputPath] = useState('');
  const [inputVisible, setInputVisible] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const handleDelete = async (node: FileNode) => {
    const label = node.type === 'directory' ? `folder "${node.name}" and all its contents` : `"${node.name}"`;
    if (!window.confirm(`Delete ${label}?\n\nThis cannot be undone.`)) return;
    try {
      await deleteNode(node.path);
      onDeleteSuccess(node.path);
      refetch();
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenFolder = async () => {
    if (!inputPath.trim()) return;
    setOpening(true);
    setOpenError(null);
    try {
      const result = await openWorkspace(inputPath.trim());
      if (result.path) {
        onWorkspaceOpen(result.path);
        setInputVisible(false);
        setInputPath('');
      }
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Failed to open folder');
    } finally {
      setOpening(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          height: 'var(--sidebar-header-height)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px 0 12px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--color-text-primary)',
            textTransform: 'uppercase',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {workspacePath ? tree?.name ?? 'Explorer' : 'Explorer'}
        </span>
        <button
          title="Refresh"
          onClick={refetch}
          style={{
            color: 'var(--color-text-secondary)',
            padding: 4,
            borderRadius: 3,
            display: workspacePath ? 'flex' : 'none',
            alignItems: 'center',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z" />
            <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {!workspacePath && !localTree ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '24px 16px',
              gap: 12,
            }}
          >
            <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center', lineHeight: 1.5 }}>
              No folder open.
            </p>
            {!inputVisible ? (
              <button
                onClick={() => setInputVisible(true)}
                style={{
                  background: 'var(--color-accent)',
                  color: '#fff',
                  padding: '6px 16px',
                  borderRadius: 3,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-accent-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-accent)')}
              >
                Open Folder
              </button>
            ) : (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  autoFocus
                  type="text"
                  value={inputPath}
                  onChange={e => setInputPath(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleOpenFolder();
                    if (e.key === 'Escape') { setInputVisible(false); setInputPath(''); setOpenError(null); }
                  }}
                  placeholder="/path/to/project"
                  style={{
                    background: '#3c3c3c',
                    border: '1px solid var(--color-accent)',
                    borderRadius: 3,
                    color: 'var(--color-text-primary)',
                    padding: '5px 8px',
                    width: '100%',
                    outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={handleOpenFolder}
                    disabled={opening}
                    style={{
                      flex: 1,
                      background: 'var(--color-accent)',
                      color: '#fff',
                      padding: '5px 0',
                      borderRadius: 3,
                      cursor: opening ? 'not-allowed' : 'pointer',
                      opacity: opening ? 0.7 : 1,
                    }}
                  >
                    {opening ? 'Opening…' : 'Open'}
                  </button>
                  <button
                    onClick={() => { setInputVisible(false); setInputPath(''); setOpenError(null); }}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 3,
                      color: 'var(--color-text-secondary)',
                      background: 'var(--color-bg-hover)',
                    }}
                  >
                    Cancel
                  </button>
                </div>
                {openError && (
                  <p style={{ color: '#f48771', fontSize: 12 }}>{openError}</p>
                )}
              </div>
            )}
          </div>
        ) : loading ? (
          <div style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>
            Loading…
          </div>
        ) : error ? (
          <div style={{ padding: '12px 16px', color: '#f48771', fontSize: 12 }}>
            {error}
          </div>
        ) : tree ? (
          <div style={{ paddingTop: 4, paddingBottom: 4 }}>
            {/* Render children of root directly (don't show root itself) */}
            {tree.children?.map(child => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={0}
                expandedPaths={expandedPaths}
                onToggleExpand={toggleExpand}
                onFileClick={onFileClick}
                activeFilePath={activeFilePath}
                gitStatus={gitStatus}
                onDelete={handleDelete}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
