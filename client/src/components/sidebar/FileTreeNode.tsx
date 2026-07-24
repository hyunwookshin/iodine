import { useState, useRef, useEffect } from 'react';
import type { FileNode } from '../../types';
import type { GitFileStatus } from '../../hooks/useGitStatus';

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onFileClick: (node: FileNode) => void;
  activeFilePath: string | null;
  gitStatus?: Record<string, GitFileStatus>;
  onDelete: (node: FileNode) => void;
  onCreate: (dirPath: string, name: string, type: 'file' | 'directory') => Promise<void>;
  onRename: (node: FileNode, newName: string) => Promise<void>;
  workspacePath?: string | null;
  onDirSummary?: (node: FileNode) => void;
  onFileSummary?: (node: FileNode) => void;
  onAddToContext?: (node: FileNode) => void;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);
const SUMMARY_EXCLUDED_EXTENSIONS = new Set(['md']);

function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(getFileExtension(filename));
}

function isSummarizable(filename: string): boolean {
  return !SUMMARY_EXCLUDED_EXTENSIONS.has(getFileExtension(filename));
}

const ChevronRight = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ flexShrink: 0 }}>
    <path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ flexShrink: 0 }}>
    <path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

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

/** Image file icon — a small landscape-style picture frame with a sun and mountain. */
const ImageFileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
    <rect x="1" y="2" width="14" height="12" rx="1.5" ry="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="5" cy="6" r="1.5" />
    <path d="M1.5 12.5 L5.5 7.5 L8.5 10.5 L10.5 8 L14.5 12.5 Z" />
  </svg>
);

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
    <path d="M5.5 6v6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M8 6v6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M10.5 6v6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M3 4h10l-.8 10.2A2 2 0 0 1 10.2 16H5.8a2 2 0 0 1-1.998-1.8L3 4z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M6 1h4a1 1 0 0 1 1 1v1H5V2a1 1 0 0 1 1-1z" />
  </svg>
);

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ flexShrink: 0 }}>
    <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

export function FileTreeNode({
  node,
  depth,
  expandedPaths,
  onToggleExpand,
  onFileClick,
  activeFilePath,
  gitStatus = {},
  onDelete,
  onCreate,
  onRename,
  workspacePath,
  onDirSummary,
  onFileSummary,
  onAddToContext,
}: FileTreeNodeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [creatingType, setCreatingType] = useState<'file' | 'directory' | null>(null);
  const [newName, setNewName] = useState('Untitled');
  const [createError, setCreateError] = useState<string | null>(null);
  // null = not probed yet, false = no cache, true = has cache
  const [summaryCached, setSummaryCached] = useState<boolean | null>(null);

  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameSubmittingRef = useRef(false);

  const isExpanded = expandedPaths.has(node.path);
  const isActive = node.path === activeFilePath;
  const isDir = node.type === 'directory';
  const isImage = !isDir && isImageFile(node.name);
  const isSymlink = !!node.isSymlink;

  // Whether this node offers an AI summary action in its dropdown menu.
  const canSummarizeDir = isDir && !!onDirSummary;
  const canSummarizeFile = !isDir && !isImage && isSummarizable(node.name) && !!onFileSummary;
  const canSummarize = canSummarizeDir || canSummarizeFile;

  // Which nodes get the "+" dropdown button: directories (new file/folder + summary + context)
  // and files that have summary or context actions.
  const canAddToContext = !!onAddToContext;
  const hasDropdown = isDir || canSummarizeFile || (!isDir && canAddToContext);

  const gs = gitStatus[node.path];
  const nameFontWeight = (gs === 'unstaged' || gs === 'both') ? 'bold' : undefined;
  const nameTextDecoration = (gs === 'staged' || gs === 'both') ? 'underline' : undefined;

  const folderIconColor = isSymlink ? '#37d5ff' : '#dcb67a';
  const fileIconColor = isSymlink ? '#37d5ff' : (isImage ? '#89d4f5' : '#c5c8c6');
  const nameColor = isSymlink && !isActive ? '#37d5ff' : undefined;

  // Select all text when the create input first appears
  useEffect(() => {
    if (creatingType && inputRef.current) {
      inputRef.current.select();
    }
  }, [creatingType]);

  // Select all text when the rename input first appears
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.select();
    }
  }, [renaming]);

  // Probe the summary cache when the dropdown opens for the first time so the
  // menu item reads "View Summary" (cached) vs "Generate Summary" (not cached).
  // Also probe on mount if the node can be summarized to show the asterisk indicator.
  useEffect(() => {
    if (!workspacePath || summaryCached !== null || !canSummarize) return;
    const relPath = node.path.startsWith(workspacePath + '/')
      ? node.path.slice(workspacePath.length + 1)
      : node.path;
    const url = isDir
      ? `${API_BASE}/api/ai-directory-summary?path=${encodeURIComponent(relPath)}`
      : `${API_BASE}/api/ai-summary?path=${encodeURIComponent(relPath)}`;
    fetch(url)
      .then(r => r.json())
      .then((data: { content: string | null }) => setSummaryCached(!!data.content))
      .catch(() => {});
  }, [isDir, workspacePath, node.path, summaryCached, canSummarize]);

  const handleClick = () => {
    if (isDir) {
      onToggleExpand(node.path);
    } else {
      onFileClick(node);
    }
  };

  const startCreating = (type: 'file' | 'directory') => {
    if (!isExpanded) onToggleExpand(node.path);
    setCreatingType(type);
    setNewName('Untitled');
    setCreateError(null);
    setDropdownOpen(false);
  };

  const cancelCreating = () => {
    setCreatingType(null);
    setNewName('Untitled');
    setCreateError(null);
  };

  const handleSummary = () => {
    setDropdownOpen(false);
    if (isDir) onDirSummary?.(node);
    else onFileSummary?.(node);
  };

  const startRenaming = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenaming(true);
    setRenameName(node.name);
    setRenameError(null);
  };

  const cancelRenaming = () => {
    setRenaming(false);
    setRenameName('');
    setRenameError(null);
  };

  const handleRename = async () => {
    const name = renameName.trim();
    if (!name) { setRenameError('Name cannot be empty'); return; }
    if (name === node.name) { cancelRenaming(); return; }
    renameSubmittingRef.current = true;
    setRenameError(null);
    try {
      await onRename(node, name);
      setRenaming(false);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Failed to rename');
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    } finally {
      renameSubmittingRef.current = false;
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setCreateError('Name cannot be empty');
      return;
    }
    submittingRef.current = true;
    setCreateError(null);
    try {
      await onCreate(node.path, name, creatingType!);
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

  const showActions = isHovered || dropdownOpen;

  return (
    <>
      {/* Row */}
      <div
        onClick={handleClick}
        title={node.path}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          paddingLeft: 8 + depth * 12,
          paddingRight: 8,
          height: 22,
          cursor: 'pointer',
          userSelect: 'none',
          background: isActive ? 'var(--color-bg-selected)' : 'transparent',
          color: isActive ? 'var(--color-text-active)' : 'var(--color-text-primary)',
        }}
        onMouseEnter={e => {
          setIsHovered(true);
          if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-hover)';
        }}
        onMouseLeave={e => {
          setIsHovered(false);
          if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
        }}
      >
        {isDir ? (
          <>
            <span style={{ color: 'var(--color-text-secondary)', display: 'flex' }}>
              {isExpanded ? <ChevronDown /> : <ChevronRight />}
            </span>
            <span style={{ color: folderIconColor, display: 'flex' }}>
              <FolderIcon open={isExpanded} />
            </span>
          </>
        ) : (
          <>
            <span style={{ width: 12, flexShrink: 0 }} />
            <span style={{ color: fileIconColor, display: 'flex' }}>
              {isImage ? <ImageFileIcon /> : <FileIcon />}
            </span>
          </>
        )}

        {renaming ? (
          <input
            ref={renameInputRef}
            autoFocus
            value={renameName}
            onChange={e => { setRenameName(e.target.value); setRenameError(null); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleRename(); }
              if (e.key === 'Escape') { e.stopPropagation(); cancelRenaming(); }
            }}
            onBlur={() => { if (!renameSubmittingRef.current) cancelRenaming(); }}
            onClick={e => e.stopPropagation()}
            style={{
              flex: 1,
              background: 'var(--color-bg-input)',
              border: `1px solid ${renameError ? '#f48771' : 'var(--color-accent)'}`,
              borderRadius: 2,
              color: 'var(--color-text-primary)',
              fontSize: 13,
              padding: '1px 4px',
              outline: 'none',
              minWidth: 0,
            }}
          />
        ) : (
          <span
            onDoubleClick={startRenaming}
            style={{
              fontSize: 13,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: nameFontWeight,
              textDecoration: nameTextDecoration,
              color: nameColor,
            }}
          >
            {node.name}
            {summaryCached === true && (
              <span style={{
                color: 'var(--color-text-secondary)',
                fontSize: 11,
                marginLeft: 4,
                opacity: 0.7,
              }}>
                AI
              </span>
            )}
          </span>
        )}

        {/* Action buttons — visible on hover */}
        {showActions && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {hasDropdown && (
              /* Wrapper div is position:relative so the dropdown positions correctly */
              <div style={{ position: 'relative' }}>
                <button
                  title={isDir ? 'New file or folder' : 'Generate summary'}
                  onClick={e => {
                    e.stopPropagation();
                    setDropdownOpen(v => !v);
                  }}
                  style={{
                    color: 'var(--color-text-secondary)',
                    padding: 2,
                    borderRadius: 3,
                    display: 'flex',
                    alignItems: 'center',
                    background: 'transparent',
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
                >
                  <PlusIcon />
                </button>

                {dropdownOpen && (
                  <>
                    {/* Backdrop — closes dropdown on outside click */}
                    <div
                      style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                      onClick={e => { e.stopPropagation(); setDropdownOpen(false); }}
                    />
                    <div style={{
                      position: 'absolute',
                      top: 20,
                      right: 0,
                      zIndex: 100,
                      background: 'var(--color-bg-sidebar)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 4,
                      minWidth: 130,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                      overflow: 'hidden',
                    }}>
                      {isDir && (['file', 'directory'] as const).map(type => (
                        <button
                          key={type}
                          onClick={e => { e.stopPropagation(); startCreating(type); }}
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
                      {canSummarize && (
                        <>
                          {isDir && <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              handleSummary();
                            }}
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
                            <span style={{ fontSize: 11 }}>
                              {summaryCached === true ? '📖' : '✨'}
                            </span>
                            {summaryCached === true ? 'View Summary' : 'Generate Summary'}
                          </button>
                        </>
                      )}
                      {canAddToContext && (
                        <>
                          <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setDropdownOpen(false);
                              onAddToContext!(node);
                            }}
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
                            <span style={{ fontSize: 11 }}>+</span>
                            Add to Context
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              title={`Delete ${isDir ? 'folder' : 'file'}`}
              onClick={e => {
                e.stopPropagation();
                onDelete(node);
              }}
              style={{
                color: 'var(--color-text-secondary)',
                padding: 2,
                borderRadius: 3,
                display: 'flex',
                alignItems: 'center',
                background: 'transparent',
                flexShrink: 0,
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#f48771')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </div>

      {/* Rename error shown below the row */}
      {renameError && (
        <div style={{
          paddingLeft: 8 + depth * 12 + 32,
          paddingRight: 8,
          fontSize: 11,
          color: '#f48771',
          lineHeight: '18px',
        }}>
          {renameError}
        </div>
      )}

      {/* Children + optional inline creation row */}
      {isDir && isExpanded && (
        <>
          {creatingType && (
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                paddingLeft: 8 + (depth + 1) * 12,
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
                    if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
                    if (e.key === 'Escape') { e.stopPropagation(); cancelCreating(); }
                  }}
                  onBlur={() => {
                    if (!submittingRef.current) cancelCreating();
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{
                    flex: 1,
                    background: 'var(--color-bg-input)',
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
                  paddingLeft: 8 + (depth + 1) * 12 + 32,
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

          {node.children?.map(child => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onFileClick={onFileClick}
              activeFilePath={activeFilePath}
              gitStatus={gitStatus}
              onDelete={onDelete}
              onCreate={onCreate}
              onRename={onRename}
              workspacePath={workspacePath}
              onDirSummary={onDirSummary}
              onFileSummary={onFileSummary}
              onAddToContext={onAddToContext}
            />
          ))}
        </>
      )}
    </>
  );
}
