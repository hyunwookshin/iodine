import { FileExplorer } from '../sidebar/FileExplorer';
import { SourceControlPanel } from '../sidebar/SourceControlPanel';
import type { FileNode, SidebarView } from '../../types';

interface SidebarProps {
  activeView: SidebarView;
  width: number;
  workspacePath: string | null;
  activeFilePath: string | null;
  onFileClick: (node: FileNode) => void;
  onDeleteSuccess: (deletedPath: string) => void;
  onRenameSuccess: (oldPath: string, newPath: string) => void;
  localTree?: FileNode | null;
  onDirSummary?: (node: FileNode) => void;
  onFileSummary?: (node: FileNode) => void;
}

export function Sidebar({
  activeView,
  width,
  workspacePath,
  activeFilePath,
  onFileClick,
  onDeleteSuccess,
  onRenameSuccess,
  localTree,
  onDirSummary,
  onFileSummary,
}: SidebarProps) {
  // Helper to open a file given only its absolute path (from SCM panel)
  const handleOpenByPath = (absPath: string) => {
    const name = absPath.split(/[/\\]/).pop() ?? absPath;
    onFileClick({ name, path: absPath, type: 'file', children: null });
  };

  return (
    <div
      style={{
        width,
        background: 'var(--color-bg-sidebar)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {activeView === 'explorer' ? (
        <FileExplorer
          workspacePath={workspacePath}
          activeFilePath={activeFilePath}
          onFileClick={onFileClick}
          onDeleteSuccess={onDeleteSuccess}
          onRenameSuccess={onRenameSuccess}
          localTree={localTree}
          onDirSummary={onDirSummary}
          onFileSummary={onFileSummary}
        />
      ) : (
        <SourceControlPanel workspacePath={workspacePath} onFileOpen={handleOpenByPath} />
      )}
    </div>
  );
}
