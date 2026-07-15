import { useMemo } from 'react';
import { useFileTree } from '../../hooks/useFileTree';
import { useGitStatus } from '../../hooks/useGitStatus';
import { FileTreeNode } from './FileTreeNode';
import { deleteNode, createNode, renameNode } from '../../api/files';
import type { FileNode } from '../../types';
import type { GitFileStatus } from '../../hooks/useGitStatus';

interface FileExplorerProps {
  workspacePath: string | null;
  activeFilePath: string | null;
  onFileClick: (node: FileNode) => void;
  onDeleteSuccess: (deletedPath: string) => void;
  onRenameSuccess: (oldPath: string, newPath: string) => void;
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
  onFileClick,
  onDeleteSuccess,
  onRenameSuccess,
  localTree,
}: FileExplorerProps) {
  const { tree, expandedPaths, toggleExpand, loading, error, refetch } = useFileTree(workspacePath, localTree);
  const rawGitStatus = useGitStatus(workspacePath);

  // Memoise aggregated status to avoid unnecessary recalculations.
  const gitStatus = useMemo(() => aggregateGitStatus(rawGitStatus), [rawGitStatus]);

  const handleCreate = async (dirPath: string, name: string, type: 'file' | 'directory') => {
    await createNode(`${dirPath}/${name}`, type); // throws on error (e.g. 409 already exists)
    refetch();
  };

  const handleRename = async (node: FileNode, newName: string) => {
    const result = await renameNode(node.path, newName); // throws on error (e.g. 409 already exists)
    onRenameSuccess(node.path, result.newPath);
    refetch();
  };

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
          <div style={{ padding: '24px 16px' }}>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.6, textAlign: 'center' }}>
              No folder open.
              <br /><br />
              Use <strong style={{ color: 'var(--color-text-primary)' }}>File &gt; Open Project</strong> in the menu bar to get started.
            </p>
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
                onCreate={handleCreate}
                onRename={handleRename}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
