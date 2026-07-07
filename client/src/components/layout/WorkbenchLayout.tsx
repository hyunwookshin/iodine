import { useState, useEffect, useRef, useCallback } from 'react';
import { ActivityBar } from './ActivityBar';
import { Sidebar } from './Sidebar';
import { EditorArea, EditorAreaHandle } from './EditorArea';
import { RightPanel } from './RightPanel';
import { ResizeDivider } from './ResizeDivider';
import { useOpenFiles } from '../../hooks/useOpenFiles';
import { getWorkspace } from '../../api/files';
import type { SidebarView } from '../../types';

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

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: 'var(--color-bg-workbench)',
      }}
    >
      <ActivityBar activeView={activeView} onViewChange={handleViewChange} />

      <Sidebar
        activeView={activeView}
        width={sidebarWidth}
        workspacePath={workspacePath}
        activeFilePath={activeFilePath}
        onWorkspaceOpen={setWorkspacePath}
        onFileClick={openFile}
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
  );
}
