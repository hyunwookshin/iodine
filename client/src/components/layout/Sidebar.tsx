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
  localTree?: FileNode | null;
}

export function Sidebar({
  activeView,
  width,
  workspacePath,
  activeFilePath,
  onWorkspaceOpen,
  onFileClick,
  localTree,
}: SidebarProps) {
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
          localTree={localTree}
        />
      ) : (
        <SourceControlPanel workspacePath={workspacePath} />
      )}
    </div>
  );
}
