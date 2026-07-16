import { useState, useEffect, useRef, useCallback } from 'react';
import { ActivityBar } from './ActivityBar';
import { MenuBar } from './MenuBar';
import { Sidebar } from './Sidebar';
import { EditorArea, EditorAreaHandle } from './EditorArea';
import { RightPanel } from './RightPanel';
import { ResizeDivider } from './ResizeDivider';
import { BottomTray } from '../bottom/BottomTray';
import { useOpenFiles } from '../../hooks/useOpenFiles';
import { useFileWatcher } from '../../hooks/useFileWatcher';
import { useTheme } from '../../hooks/useTheme';
import { getWorkspace, closeWorkspace } from '../../api/files';
import type { SidebarView } from '../../types';

const SIDEBAR_DEFAULT = 240;
const RIGHT_PANEL_DEFAULT = 400;
const SIDEBAR_MIN = 140;
const SIDEBAR_MAX = 600;
const RIGHT_MIN = 180;
const RIGHT_MAX = 1200;
const TRAY_DEFAULT = 200;
const TRAY_MIN = 80;
const TRAY_MAX = 600;

export function WorkbenchLayout() {
  const [activeView, setActiveView] = useState<SidebarView>('explorer');
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT);
  const [trayHeight, setTrayHeight] = useState(TRAY_DEFAULT);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();

  const editorAreaRef = useRef<EditorAreaHandle>(null);

  const {
    openFiles,
    activeFilePath,
    setActiveFilePath,
    openFile,
    updateContent,
    saveFile,
    closeFile,
    closeAllFiles,
    refreshFile,
  } = useOpenFiles();

  useFileWatcher(workspacePath, refreshFile);

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

  /** Shared handler — opens a server-side workspace from any entrypoint
   *  (menu bar, sidebar, or Coding Assistant inline input). */
  const handleWorkspaceOpen = useCallback((path: string) => {
    // If it's the same workspace, just make sure the explorer is visible
    if (path === workspacePath) {
      setActiveView('explorer');
      return;
    }

    // Warn only about files with unsaved changes (not written to disk yet).
    // Files that are saved but uncommitted in git have isDirty === false — no warning needed.
    const unsaved = openFiles.filter(f => f.isDirty);
    if (unsaved.length > 0) {
      const list = unsaved.map(f => `• ${f.name}`).join('\n');
      const confirmed = window.confirm(
        `Switching workspaces will close all open files.\n\n` +
        `The following ${unsaved.length === 1 ? 'file has' : 'files have'} unsaved changes that have not been written to disk:\n\n` +
        `${list}\n\nDiscard changes and switch workspace?`
      );
      if (!confirmed) return;
    }

    closeAllFiles();
    setWorkspacePath(path);
    setActiveView('explorer');
  }, [workspacePath, openFiles, closeAllFiles]);

  const handleCloseProject = useCallback(() => {
    closeAllFiles();
    setWorkspacePath(null);
    closeWorkspace().catch(() => {});
  }, [closeAllFiles]);

  /** Close any open tabs that were inside the deleted file or directory. */
  const handleDeleteSuccess = useCallback((deletedPath: string) => {
    openFiles
      .filter(f => f.path === deletedPath || f.path.startsWith(deletedPath + '/'))
      .forEach(f => closeFile(f.path));
  }, [openFiles, closeFile]);

  /** Close tabs for the old path when a file or directory is renamed. */
  const handleRenameSuccess = useCallback((oldPath: string) => {
    openFiles
      .filter(f => f.path === oldPath || f.path.startsWith(oldPath + '/'))
      .forEach(f => closeFile(f.path));
  }, [openFiles, closeFile]);

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
      <MenuBar
        onOpenProject={handleWorkspaceOpen}
        onCloseProject={handleCloseProject}
        workspacePath={workspacePath}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {/* Main row: sidebar + editor + right panel */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <ActivityBar activeView={activeView} onViewChange={handleViewChange} />

          <Sidebar
            activeView={activeView}
            width={sidebarWidth}
            workspacePath={workspacePath}
            activeFilePath={activeFilePath}
            onFileClick={openFile}
            onDeleteSuccess={handleDeleteSuccess}
            onRenameSuccess={handleRenameSuccess}
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
            workspacePath={workspacePath}
          />

          <ResizeDivider
            currentWidth={rightPanelWidth}
            onResize={setRightPanelWidth}
            min={RIGHT_MIN}
            max={RIGHT_MAX}
            side="right"
          />

          <RightPanel
            width={rightPanelWidth}
            workspacePath={workspacePath}
            activeFilePath={activeFilePath}
            onWorkspaceOpen={handleWorkspaceOpen}
          />
        </div>

        {/* Horizontal resize handle + bottom tray */}
        <ResizeDivider
          orientation="horizontal"
          currentWidth={trayHeight}
          onResize={setTrayHeight}
          min={TRAY_MIN}
          max={TRAY_MAX}
        />
        <BottomTray height={trayHeight} workspacePath={workspacePath} />
      </div>
    </div>
  );
}
