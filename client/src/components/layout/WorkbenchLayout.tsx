import { useState, useEffect, useRef, useCallback } from 'react';
import { ActivityBar } from './ActivityBar';
import { MenuBar } from './MenuBar';
import { Sidebar } from './Sidebar';
import { EditorArea, EditorAreaHandle } from './EditorArea';
import { RightPanel } from './RightPanel';
import { ResizeDivider } from './ResizeDivider';
import { BottomTray, BottomTrayHandle } from '../bottom/BottomTray';
import { useOpenFiles } from '../../hooks/useOpenFiles';
import { useFileWatcher } from '../../hooks/useFileWatcher';
import { useTheme } from '../../hooks/useTheme';
import { getWorkspace, closeWorkspace } from '../../api/files';
import { PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODEL } from '../../providers';
import type { Provider } from '../../providers';
import type { FileNode, SidebarView } from '../../types';

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

  // When set, the EditorArea should switch to the AI summary view for this file path.
  const [summaryRequestPath, setSummaryRequestPath] = useState<string | null>(null);

  // Paths/nodes added to the Coding Assistant context via the file-tree dropdown.
  const [contextNodes, setContextNodes] = useState<FileNode[]>([]);

  // AI provider/model — shared by RightPanel (chat/system view) and EditorArea (AI summary)
  const [provider, setProviderState] = useState<Provider>(DEFAULT_PROVIDER);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const setProvider = useCallback((id: string) => {
    const p = PROVIDERS.find(p => p.id === id) ?? DEFAULT_PROVIDER;
    setProviderState(p);
    setModel(p.models[0].id);
  }, []);

  const editorAreaRef = useRef<EditorAreaHandle>(null);
  const getEditorContext = useCallback(() => editorAreaRef.current?.getVisibleContext() ?? null, []);

  const bottomTrayRef = useRef<BottomTrayHandle>(null);
  const runCommandInTerminal = useCallback((cmd: string) => {
    bottomTrayRef.current?.runCommand(cmd);
  }, []);

  const {
    openFiles,
    activeFilePath,
    setActiveFilePath,
    openFile,
    openDirectory,
    updateContent,
    saveFile,
    closeFile,
    closeAllFiles,
    refreshFile,
  } = useOpenFiles();

  useFileWatcher(workspacePath, refreshFile);

  /** Open a file and request the editor to display its AI summary. */
  const handleFileSummary = useCallback((node: FileNode) => {
    openFile(node);
    setSummaryRequestPath(node.path);
  }, [openFile]);

  /** Open a directory tab and request the editor to display its AI summary. */
  const handleDirSummary = useCallback((node: FileNode) => {
    openDirectory(node);
    setSummaryRequestPath(node.path);
  }, [openDirectory]);

  /** Add a file or directory to the Coding Assistant context chips. */
  const handleAddToContext = useCallback((node: FileNode) => {
    setContextNodes(prev => prev.some(n => n.path === node.path) ? prev : [...prev, node]);
  }, []);

  /** Remove a single path from the context chips. */
  const handleRemoveContextNode = useCallback((path: string) => {
    setContextNodes(prev => prev.filter(n => n.path !== path));
  }, []);

  /** Clear all context chips (called by CodingAssistant after sending). */
  const handleClearContextNodes = useCallback(() => {
    setContextNodes([]);
  }, []);

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
            onDirSummary={handleDirSummary}
            onFileSummary={handleFileSummary}
            onAddToContext={handleAddToContext}
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
            provider={provider}
            model={model}
            summaryRequestPath={summaryRequestPath}
            onSummaryHandled={() => setSummaryRequestPath(null)}
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
            provider={provider}
            model={model}
            setProvider={setProvider}
            setModel={setModel}
            getEditorContext={getEditorContext}
            runCommandInTerminal={runCommandInTerminal}
            contextNodes={contextNodes}
            onRemoveContextNode={handleRemoveContextNode}
            onClearContextNodes={handleClearContextNodes}
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
        <BottomTray ref={bottomTrayRef} height={trayHeight} workspacePath={workspacePath} />
      </div>
    </div>
  );
}
