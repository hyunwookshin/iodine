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
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);

function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(getFileExtension(filename));
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
    <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1.5v2a1 1 0 0 0 1 1h2L9.5 1.5z" />
  </svg>
);

/** Image file icon — a small landscape-style picture frame with a sun and mountain. */
const ImageFileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
    {/* Frame */}
    <rect x="1" y="2" width="14" height="12" rx="1.5" ry="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    {/* Sun circle */}
    <circle cx="5" cy="6" r="1.5" />
    {/* Mountain path */}
    <path d="M1.5 12.5 L5.5 7.5 L8.5 10.5 L10.5 8 L14.5 12.5 Z" />
  </svg>
);

export function FileTreeNode({
  node,
  depth,
  expandedPaths,
  onToggleExpand,
  onFileClick,
  activeFilePath,
  gitStatus = {},
}: FileTreeNodeProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isActive = node.path === activeFilePath;
  const isDir = node.type === 'directory';
  const isImage = !isDir && isImageFile(node.name);

  const gs = gitStatus[node.path];
  const nameFontWeight = (gs === 'unstaged' || gs === 'both') ? 'bold' : undefined;
  const nameTextDecoration = (gs === 'staged' || gs === 'both') ? 'underline' : undefined;

  const handleClick = () => {
    if (isDir) {
      onToggleExpand(node.path);
    } else {
      onFileClick(node);
    }
  };

  return (
    <>
      <div
        onClick={handleClick}
        title={node.path}
        style={{
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
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        onMouseEnter={e => {
          if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-hover)';
        }}
        onMouseLeave={e => {
          if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
        }}
      >
        {isDir ? (
          <>
            <span style={{ color: 'var(--color-text-secondary)', display: 'flex' }}>
              {isExpanded ? <ChevronDown /> : <ChevronRight />}
            </span>
            <span style={{ color: '#dcb67a', display: 'flex' }}>
              <FolderIcon open={isExpanded} />
            </span>
          </>
        ) : (
          <>
            <span style={{ width: 12, flexShrink: 0 }} />
            <span style={{ color: isImage ? '#89d4f5' : '#c5c8c6', display: 'flex' }}>
              {isImage ? <ImageFileIcon /> : <FileIcon />}
            </span>
          </>
        )}
        <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: nameFontWeight, textDecoration: nameTextDecoration }}>
          {node.name}
        </span>
      </div>

      {isDir && isExpanded && node.children && (
        <>
          {node.children.map(child => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onFileClick={onFileClick}
              activeFilePath={activeFilePath}
              gitStatus={gitStatus}
            />
          ))}
        </>
      )}
    </>
  );
}
