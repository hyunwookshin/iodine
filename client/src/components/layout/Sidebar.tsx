import { FileExplorer } from '../sidebar/FileExplorer';
import { SourceControlPanel } from '../sidebar/SourceControlPanel';
import type { FileNode, SidebarView } from '../../types';

interface SidebarProps {
  activeView: SidebarView;
  width: number;
  workspacePath: string | null;
  activeFilePath: string | null;
  onWorkspaceOpen: (path: string) => void;
  onFileClick: (node: FileNode) => void;
  onDeleteSuccess: (deletedPath: string) => void;
  localTree?: FileNode | null;
}

export function Sidebar({
  activeView,
  width,
  workspacePath,
  activeFilePath,
  onWorkspaceOpen,
  onFileClick,
  onDeleteSuccess,
  localTree,
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
          onWorkspaceOpen={onWorkspaceOpen}
          onFileClick={onFileClick}
          onDeleteSuccess={onDeleteSuccess}
          localTree={localTree}
        />
      ) : (
        <SourceControlPanel workspacePath={workspacePath} onFileOpen={handleOpenByPath} />
      )}
    </div>
  );
}
