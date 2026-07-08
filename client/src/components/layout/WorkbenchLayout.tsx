import { useState, useEffect, useRef, useCallback } from 'react';
import { ActivityBar } from './ActivityBar';
import { MenuBar } from './MenuBar';
import { Sidebar } from './Sidebar';
import { EditorArea, EditorAreaHandle } from './EditorArea';
import { RightPanel } from './RightPanel';
import { ResizeDivider } from './ResizeDivider';
import { useOpenFiles } from '../../hooks/useOpenFiles';
import { buildLocalFileTree } from '../../utils/localFileTree';
import { getWorkspace } from '../../api/files';
import type { FileNode, SidebarView } from '../../types';

const SIDEBAR_DEFAULT = 240;
const RIGHT_PANEL_DEFAULT = 280;
const SIDEBAR_MIN = 140;
const SIDEBAR_MAX = 600;
const RIGHT_MIN = 180;
const RIGHT_MAX = 600;

export function WorkbenchLayout() {
  const [activeView, setActiveView] = useState<SidebarView>('explorer');
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [localTree, setLocalTree] = useState<FileNode | null>(null);

  const editorAreaRef = useRef<EditorAreaHandle>(null);

  const {
    openFiles,
    activeFile,
    activeFilePath,
    setActiveFilePath,
    openFile,
    updateContent,
    saveFile,
    closeFile,
    setLocalFileMap,
  } = useOpenFiles();

  // Restore workspace from server on mount
  useEffect(() => {
    getWorkspace().then(ws => {
      if (ws.path) setWorkspacePath(ws.path);
    }).catch(() => {});
  }, []);

  // Ctrl+S / Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile(activeFilePath);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [saveFile, activeFilePath]);

  const handleViewChange = useCallback((view: SidebarView) => {
    setActiveView(view);
  }, []);

  /** Called when the user picks a project via File > Open Project in the menu bar. */
  const handleOpenProject = useCallback((files: FileList) => {
    const { tree, fileMap } = buildLocalFileTree(files);
    setLocalTree(tree);
    setLocalFileMap(fileMap);
    // Clear server workspace — the local tree takes over the explorer
    setWorkspacePath(null);
    setActiveView('explorer');
  }, [setLocalFileMap]);

  /** Called when the user opens a server-backed workspace via the sidebar text input. */
  const handleWorkspaceOpen = useCallback((path: string) => {
    setWorkspacePath(path);
    // Clear any previously loaded local tree
    setLocalTree(null);
    setLocalFileMap(null);
  }, [setLocalFileMap]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: 'var(--color-bg-workbench)',
      }}
    >
      <MenuBar onOpenProject={handleOpenProject} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ActivityBar activeView={activeView} onViewChange={handleViewChange} />

        <Sidebar
          activeView={activeView}
          width={sidebarWidth}
          workspacePath={workspacePath}
          activeFilePath={activeFilePath}
          onWorkspaceOpen={handleWorkspaceOpen}
          onFileClick={openFile}
          localTree={localTree}
        />

        <ResizeDivider
          currentWidth={sidebarWidth}
          onResize={setSidebarWidth}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          side="left"
        />

        <EditorArea
          ref={editorAreaRef}
          openFiles={openFiles}
          activeFilePath={activeFilePath}
          onTabClick={setActiveFilePath}
          onTabClose={closeFile}
          onContentChange={updateContent}
        />

        <ResizeDivider
          currentWidth={rightPanelWidth}
          onResize={setRightPanelWidth}
          min={RIGHT_MIN}
          max={RIGHT_MAX}
          side="right"
        />

        <RightPanel width={rightPanelWidth} />
      </div>
    </div>
  );
}
