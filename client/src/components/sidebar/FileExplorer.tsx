import { useMemo, useState, useRef, useEffect } from 'react';
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
  onDirSummary?: (node: FileNode) => void;
  onFileSummary?: (node: FileNode) => void;
  onAddToContext?: (node: FileNode) => void;
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

const FolderIcon = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
    {open ? (
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.586a1 1 0 0 1 .707.293L8.5 4H13.5A1.5 1.5 0 0 1 15 5.5v1.086a2.5 2.5 0 0 0-.5-.086H2a2 2 0 0 0-2 2V12a1.5 1.5 0 0 1-1.5-1.5v-7z" />
    ) : (
      <path d="M.54 3.87L.5 3a2 2 0 0 1 2-2h3.19a2 2 0 0 1 1.45.63l.41.44H14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V5.07a2.5 2.5 0 0 0 .54-1.2z" />
    )}
  </svg>
);

const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
    <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 4-2zm5.5 1.5v2a1 1 0 0 0 1 1h2L9.5 1.5z" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor" style={{ flexShrink: 0 }}>
    <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

export function FileExplorer({
  workspacePath,
  activeFilePath,
  onFileClick,
  onDeleteSuccess,
  onRenameSuccess,
  localTree,
  onDirSummary,
  onFileSummary,
  onAddToContext,
}: FileExplorerProps) {
  const { tree, expandedPaths, toggleExpand, loading, error, refetch } = useFileTree(workspacePath, localTree);
  const rawGitStatus = useGitStatus(workspacePath);

  // Memoise aggregated status to avoid unnecessary recalculations.
  const gitStatus = useMemo(() => aggregateGitStatus(rawGitStatus), [rawGitStatus]);

  // Root-level creation state (for the header "+" button)
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [creatingType, setCreatingType] = useState<'file' | 'directory' | null>(null);
  const [newName, setNewName] = useState('Untitled');
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  // Select all text when the create input first appears
  useEffect(() => {
    if (creatingType && inputRef.current) {
      inputRef.current.select();
    }
  }, [creatingType]);

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

  const startCreatingRoot = (type: 'file' | 'directory') => {
    setCreatingType(type);
    setNewName('Untitled');
    setCreateError(null);
    setDropdownOpen(false);
  };

  const cancelCreatingRoot = () => {
    setCreatingType(null);
    setNewName('Untitled');
    setCreateError(null);
  };

  const handleCreateRoot = async () => {
    const name = newName.trim();
    if (!name) {
      setCreateError('Name cannot be empty');
      return;
    }
    if (!tree) return;
    submittingRef.current = true;
    setCreateError(null);
    try {
      await handleCreate(tree.path, name, creatingType!);
      setCreatingType(null);
      setNewName('Untitled');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create');
      inputRef.current?.focus();
      inputRef.current?.select();
    } finally {
      submittingRef.current = false;
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
        <div style={{ display: (workspacePath || localTree) && tree ? 'flex' : 'none', alignItems: 'center', gap: 2 }}>
          {/* New file / folder */}
          <div style={{ position: 'relative', display: 'flex' }}>
            <button
              title="New file or folder"
              onClick={() => setDropdownOpen(v => !v)}
              style={{
                color: 'var(--color-text-secondary)',
                padding: 4,
                borderRadius: 3,
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <PlusIcon />
            </button>

            {dropdownOpen && (
              <>
                {/* Backdrop — closes dropdown on outside click */}
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                  onClick={() => setDropdownOpen(false)}
                />
                <div style={{
                  position: 'absolute',
                  top: 24,
                  right: 0,
                  zIndex: 100,
                  background: '#2d2d2d',
                  border: '1px solid #555',
                  borderRadius: 4,
                  minWidth: 130,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  overflow: 'hidden',
                }}>
                  {(['file', 'directory'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => startCreatingRoot(type)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        padding: '6px 10px',
                        background: 'transparent',
                        color: 'var(--color-text-primary)',
                        fontSize: 12,
                        textAlign: 'left',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ color: type === 'directory' ? '#dcb67a' : '#c5c8c6', display: 'flex' }}>
                        {type === 'directory' ? <FolderIcon open={false} /> : <FileIcon />}
                      </span>
                      {type === 'directory' ? 'New Folder' : 'New File'}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Refresh */}
          <button
            title="Refresh"
            onClick={refetch}
            style={{
              color: 'var(--color-text-secondary)',
              padding: 4,
              borderRadius: 3,
              display: 'flex',
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
            {/* Inline creation row at the root level */}
            {creatingType && (
              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  paddingLeft: 8,
                  paddingRight: 8,
                  height: 22,
                }}>
                  <span style={{ width: 12, flexShrink: 0 }} />
                  <span style={{ color: creatingType === 'directory' ? '#dcb67a' : '#c5c8c6', display: 'flex' }}>
                    {creatingType === 'directory' ? <FolderIcon open={false} /> : <FileIcon />}
                  </span>
                  <input
                    ref={inputRef}
                    autoFocus
                    value={newName}
                    onChange={e => { setNewName(e.target.value); setCreateError(null); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); handleCreateRoot(); }
                      if (e.key === 'Escape') { e.stopPropagation(); cancelCreatingRoot(); }
                    }}
                    onBlur={() => {
                      if (!submittingRef.current) cancelCreatingRoot();
                    }}
                    style={{
                      flex: 1,
                      background: '#3c3c3c',
                      border: `1px solid ${createError ? '#f48771' : 'var(--color-accent)'}`,
                      borderRadius: 2,
                      color: 'var(--color-text-primary)',
                      fontSize: 13,
                      padding: '1px 4px',
                      outline: 'none',
                      minWidth: 0,
                    }}
                  />
                </div>
                {createError && (
                  <div style={{
                    paddingLeft: 8 + 32,
                    paddingRight: 8,
                    fontSize: 11,
                    color: '#f48771',
                    lineHeight: '18px',
                  }}>
                    {createError}
                  </div>
                )}
              </div>
            )}

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
                workspacePath={workspacePath}
                onDirSummary={onDirSummary}
                onFileSummary={onFileSummary}
                onAddToContext={onAddToContext}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
