import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ActivityBar } from './ActivityBar';
import { MenuBar } from './MenuBar';
import { Sidebar } from './Sidebar';
import { EditorArea, EditorAreaHandle } from './EditorArea';
import { RightPanel, RightPanelHandle } from './RightPanel';
import { ResizeDivider } from './ResizeDivider';
import { StatusBar } from './StatusBar';
import { BottomTray, BottomTrayHandle } from '../bottom/BottomTray';
import { useOpenFiles, sortOpenFilesByStructure } from '../../hooks/useOpenFiles';
import { useFileWatcher } from '../../hooks/useFileWatcher';
import { useTheme } from '../../hooks/useTheme';
import { useSourceControl } from '../../hooks/useSourceControl';
import { getWorkspace, closeWorkspace, rephraseProactiveMessage, checkoutBranch } from '../../api/files';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { useProactiveHelp } from '../../hooks/useProactiveHelp';
import { createIdleChurnSignal } from '../../services/proactiveSignals';
import { usePanelExpansion, DEFAULT_PANEL_EXPANSION_CONFIG } from '../../hooks/usePanelExpansion';
import { PROVIDERS, DEFAULT_PROVIDER, DEFAULT_MODEL } from '../../providers';
import type { Provider } from '../../providers';
import type { FileNode, SidebarView } from '../../types';

const SIDEBAR_DEFAULT = 320;
const RIGHT_PANEL_DEFAULT = 400;
const SIDEBAR_MIN = 140;
const SIDEBAR_MAX = 600;
const RIGHT_MIN = 180;
const RIGHT_MAX = 1200;
const TRAY_DEFAULT = 200;
const TRAY_MIN = 80;
const TRAY_MAX = 600;

function playBell() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.9);
  } catch {
    // AudioContext unavailable — silently skip
  }
}

export function WorkbenchLayout() {
  const [activeView, setActiveView] = useState<SidebarView>('explorer');
  const [currentEditorView, setCurrentEditorView] = useState('source');
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [summaryOutlineContent, setSummaryOutlineContent] = useState('');
  const [fileTreeRefreshKey, setFileTreeRefreshKey] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT);
  const { isExpanded, animated: panelAnimated, onAssistantReply, onOpenFile: onPanelShrinkForFile, resetExpansion } = usePanelExpansion(DEFAULT_PANEL_EXPANSION_CONFIG);
  const effectiveRightWidth = isExpanded
    ? Math.max(rightPanelWidth, DEFAULT_PANEL_EXPANSION_CONFIG.expandedWidth)
    : rightPanelWidth;

  // Pulse the panel border when the LLM triggers expansion, stop it when it shrinks back.
  useEffect(() => {
    if (isExpanded) {
      rightPanelRef.current?.triggerPulse();
    } else {
      rightPanelRef.current?.stopPulse();
    }
  }, [isExpanded]);
  const [trayHeight, setTrayHeight] = useState(TRAY_DEFAULT);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showBottomTray, setShowBottomTray] = useState(false);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();
  const { updateInfo, snooze: snoozeUpdate, lastPingAt } = useUpdateCheck(typeof __APP_REPO__ !== 'undefined' ? __APP_REPO__ : '');

  // When set, the EditorArea should switch to the AI summary view for this file path.
  const [summaryRequestPath, setSummaryRequestPath] = useState<string | null>(null);
  // When set, the EditorArea should switch to preview for this file path (wiki-style md navigation).
  const [previewRequestPath, setPreviewRequestPath] = useState<string | null>(null);
  // When set, the EditorArea shows the commit diff overlay for this hash.
  const [activeCommitHash, setActiveCommitHash] = useState<string | null>(null);
  // Commit diff context chip for the Coding Assistant.
  const [commitDiffContext, setCommitDiffContext] = useState<{ shortHash: string; content: string } | null>(null);
  // Back/forward navigation stack (up to 20 entries).
  const [nav, setNav] = useState<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const navBypassRef = useRef(false);

  // Custom confirm dialog for workspace switching (replaces window.confirm)
  const [workspaceConfirm, setWorkspaceConfirm] = useState<{
    message: string;
    hasUnsaved: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Paths/nodes added to the Coding Assistant context via the file-tree dropdown.
  const [contextNodes, setContextNodes] = useState<FileNode[]>([]);

  // AI provider/model — shared by RightPanel (chat/system view) and EditorArea (AI summary)
  const [provider, setProviderState] = useState<Provider>(() => {
    try {
      const savedId = localStorage.getItem('iodine-provider');
      return PROVIDERS.find(p => p.id === savedId) ?? DEFAULT_PROVIDER;
    } catch {
      return DEFAULT_PROVIDER;
    }
  });
  const [model, setModelState] = useState<string>(() => {
    try {
      const savedId = localStorage.getItem('iodine-provider');
      const savedModel = localStorage.getItem('iodine-model');
      const savedProvider = PROVIDERS.find(p => p.id === savedId) ?? DEFAULT_PROVIDER;
      return savedProvider.models.some(m => m.id === savedModel) ? savedModel! :
        savedProvider.id === DEFAULT_PROVIDER.id ? DEFAULT_MODEL : savedProvider.models[0].id;
    } catch {
      return DEFAULT_MODEL;
    }
  });
  const setModel = useCallback((id: string) => {
    setModelState(id);
    try { localStorage.setItem('iodine-model', id); } catch { /* storage unavailable */ }
  }, []);
  const setProvider = useCallback((id: string) => {
    const p = PROVIDERS.find(p => p.id === id) ?? DEFAULT_PROVIDER;
    setProviderState(p);
    setModel(p.models[0].id);
    try { localStorage.setItem('iodine-provider', p.id); } catch { /* storage unavailable */ }
  }, [setModel]);

  const pushNav = useCallback((path: string) => {
    setNav(prev => {
      const truncated = prev.stack.slice(0, prev.index + 1);
      if (truncated[truncated.length - 1] === path) return prev;
      const newStack = [...truncated, path].slice(-20);
      return { stack: newStack, index: newStack.length - 1 };
    });
  }, []);

  // Git status for badge
  const sc = useSourceControl(workspacePath);
  const gitChangeCount = sc.staged.length + sc.unstaged.length;

  const editorAreaRef = useRef<EditorAreaHandle>(null);
  const getEditorContext = useCallback(() => editorAreaRef.current?.getVisibleContext() ?? null, []);

  const [activeSystemNode, setActiveSystemNode] = useState<string | null>(null);

  const rightPanelRef = useRef<RightPanelHandle>(null);
  const handleNodeSelect = useCallback((node: FileNode) => {
    rightPanelRef.current?.lookupByPath(node.path);
  }, []);

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
    openUrl,
    openExternalFile,
    updateContent,
    saveFile,
    closeFile,
    closeAllFiles,
    closeUneditedFiles,
    reorderFiles,
    refreshFile,
    setSortedFiles,
  } = useOpenFiles();

  useFileWatcher(workspacePath, refreshFile);

  // Clear the commit diff overlay when the workspace changes.
  useEffect(() => { setActiveCommitHash(null); }, [workspacePath]);

  const goBack = useCallback(() => {
    if (nav.index <= 0) return;
    const newIndex = nav.index - 1;
    const targetPath = nav.stack[newIndex];
    if (targetPath === activeFilePath) { setNav(prev => ({ ...prev, index: newIndex })); return; }
    navBypassRef.current = true;
    setNav(prev => ({ ...prev, index: newIndex }));
    const existing = openFiles.find(f => f.path === targetPath);
    if (existing) setActiveFilePath(targetPath);
    else openFile({ path: targetPath, name: targetPath.split(/[/\\]/).pop() ?? targetPath, type: 'file', children: null });
  }, [nav, activeFilePath, openFiles, setActiveFilePath, openFile]);

  const goForward = useCallback(() => {
    if (nav.index >= nav.stack.length - 1) return;
    const newIndex = nav.index + 1;
    const targetPath = nav.stack[newIndex];
    if (targetPath === activeFilePath) { setNav(prev => ({ ...prev, index: newIndex })); return; }
    navBypassRef.current = true;
    setNav(prev => ({ ...prev, index: newIndex }));
    const existing = openFiles.find(f => f.path === targetPath);
    if (existing) setActiveFilePath(targetPath);
    else openFile({ path: targetPath, name: targetPath.split(/[/\\]/).pop() ?? targetPath, type: 'file', children: null });
  }, [nav, activeFilePath, openFiles, setActiveFilePath, openFile]);

  // ── Proactive help ───────────────────────────────────────────────────────────
  const actionCountRef = useRef(0);
  const recordAction = useCallback(() => { actionCountRef.current++; }, []);

  const workspacePathRef  = useRef(workspacePath);
  const activeFilePathRef = useRef(activeFilePath);
  workspacePathRef.current  = workspacePath;
  activeFilePathRef.current = activeFilePath;

  const idleChurnSignal = useMemo(() => createIdleChurnSignal({
    getWorkspacePath:  () => workspacePathRef.current,
    getActiveFilePath: () => activeFilePathRef.current,
  }), []); // stable — accessors read from refs at collection time

  const { status: proactiveStatus, startCooldown: startProactiveCooldown, setAssistantBusy } = useProactiveHelp({
    signals: [idleChurnSignal],
    enabled: !!workspacePath,
    actionCountRef,
    onTrigger: async (message, collectContext) => {
      const rephrased = await rephraseProactiveMessage(message, provider.id, model);
      playBell();
      rightPanelRef.current?.triggerPulse();
      rightPanelRef.current?.injectProactiveMessage(rephrased, collectContext);
    },
  });

  // Keep System View in sync with the active editor file.
  // Also propagate the matched node name so CodingAssistant can show a navigation chip.
  // File navigation also counts as user activity for proactive help.
  useEffect(() => {
    const matched = rightPanelRef.current?.syncActiveFile(activeFilePath);
    setActiveSystemNode(matched ?? null);
    if (activeFilePath) recordAction();
    // Reset outline state when the active file changes
    setActiveHeadingId(null);
    setSummaryOutlineContent('');
  }, [activeFilePath, recordAction]);

  // Push each user-initiated file navigation onto the back/forward stack.
  // Back/forward navigations set navBypassRef to skip this push.
  useEffect(() => {
    if (!activeFilePath) return;
    if (navBypassRef.current) { navBypassRef.current = false; return; }
    pushNav(activeFilePath);
  }, [activeFilePath, pushNav]);

  /** Open a URL as an iframe tab in the editor area. */
  const handleOpenUrl = useCallback((url: string) => {
    openUrl(url);
  }, [openUrl]);

  /** Open a file and navigate the Monaco editor to a specific line range (used by Tutor Mode). */
  const handleNavigateToLine = useCallback((filePath: string, line: number, endLine?: number, startCol?: number, endCol?: number) => {
    onPanelShrinkForFile();
    const name = filePath.split('/').pop() ?? filePath;
    openFile({ path: filePath, name, type: 'file', children: null });
    // Delay slightly so the tab activates and the editor mounts before we apply the highlight
    setTimeout(() => {
      editorAreaRef.current?.navigateToLine(filePath, line, endLine, startCol, endCol);
    }, 100);
  }, [openFile]);

  /** Open a file and request the editor to display its AI summary. */
  const handleFileSummary = useCallback((node: FileNode) => {
    openFile(node);
    setSummaryRequestPath(node.path);
  }, [openFile]);

  /** Called by the agent's invoke_summary tool — opens the file and switches to summary view. */
  const handleAgentSummaryRequest = useCallback((absPath: string) => {
    const name = absPath.split('/').pop() ?? absPath;
    openFile({ path: absPath, name, type: 'file', children: null });
    setSummaryRequestPath(absPath);
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
    if (view !== 'scm') setActiveCommitHash(null);
  }, []);

  const [pendingCommitMessage, setPendingCommitMessage] = useState<string | null>(null);

  useEffect(() => {
    const showSourceControl = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message ?? null;
      setShowSidebar(true);
      setActiveView('scm');
      if (message) setPendingCommitMessage(message);
    };
    window.addEventListener('iodine:git-commit-compose', showSourceControl);
    return () => window.removeEventListener('iodine:git-commit-compose', showSourceControl);
  }, []);

  const handleEditorViewChange = useCallback((view: string) => {
    setCurrentEditorView(view);
    if (view === 'preview' || view === 'summary') {
      setActiveView('outline');
      setActiveHeadingId(null);
    } else {
      setActiveView(v => v === 'outline' ? 'explorer' : v);
    }
  }, []);

  const handlePreview = useCallback(() => {
    // Only allow preview for markdown files
    if (activeFilePath && /\.(md|markdown)$/i.test(activeFilePath)) {
      setCurrentEditorView('preview');
      setActiveView('outline');
      setActiveHeadingId(null);
    }
  }, [activeFilePath]);

  const handleOutlineNavigate = useCallback((id: string) => {
    setActiveHeadingId(id);
    editorAreaRef.current?.scrollToHeading(id);
  }, []);

  /** Shared handler — opens a server-side workspace from any entrypoint
   *  (menu bar, sidebar, or Coding Assistant inline input). */
  const handleWorkspaceOpen = useCallback((path: string) => {
    // If it's the same workspace, just make sure the explorer is visible
    if (path === workspacePath) {
      setActiveView('explorer');
      return;
    }

    const doSwitch = () => {
      closeAllFiles();
      setWorkspacePath(path);
      setActiveView('explorer');
    };

    if (openFiles.length > 0) {
      const unsaved = openFiles.filter(f => f.isDirty);
      const message = unsaved.length > 0
        ? `Switching workspaces will close all open tabs.\n\n` +
          `The following ${unsaved.length === 1 ? 'file has' : 'files have'} unsaved changes:\n\n` +
          unsaved.map(f => `• ${f.name}`).join('\n')
        : `Switching workspaces will close ${openFiles.length} open ${openFiles.length === 1 ? 'tab' : 'tabs'}.`;
      setWorkspaceConfirm({
        message,
        hasUnsaved: unsaved.length > 0,
        onConfirm: () => { setWorkspaceConfirm(null); doSwitch(); },
      });
      return;
    }

    doSwitch();
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

  /** Sort tabs by file structure using tree traversal order. */
  const handleSortTabsByFileStructure = useCallback(() => {
    setSortedFiles(sortOpenFilesByStructure(openFiles));
  }, [openFiles, setSortedFiles]);

  /** Open a workspace file by absolute path (routes through workspace API, not external). */
  const openWorkspaceFile = useCallback((absolutePath: string) => {
    const name = absolutePath.split(/[/\\]/).pop() ?? absolutePath;
    openFile({ path: absolutePath, name, type: 'file', children: null });
  }, [openFile]);

  const handleCommitCheckout = useCallback(async (hash: string) => {
    await checkoutBranch(hash, true);
    setActiveCommitHash(null);
  }, []);

  // Check if preview button should be enabled
  const canPreview = !!activeFilePath && /\.(md|markdown)$/i.test(activeFilePath);

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
      {/* Workspace switch confirmation dialog */}
      {workspaceConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--color-bg-sidebar)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '20px 24px',
            maxWidth: 420,
            width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', marginBottom: 20, lineHeight: 1.6 }}>
              {workspaceConfirm.message}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setWorkspaceConfirm(null)}
                style={{
                  padding: '5px 14px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                  background: 'transparent', border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={workspaceConfirm.onConfirm}
                style={{
                  padding: '5px 14px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                  background: workspaceConfirm.hasUnsaved ? '#c53030' : 'var(--color-accent)',
                  border: workspaceConfirm.hasUnsaved ? '1px solid #c53030' : '1px solid var(--color-accent)',
                  color: '#fff', fontWeight: 600,
                }}
              >
                {workspaceConfirm.hasUnsaved ? 'Discard & Switch' : 'Switch'}
              </button>
            </div>
          </div>
        </div>
      )}
      <MenuBar
        onOpenProject={handleWorkspaceOpen}
        onCloseProject={handleCloseProject}
        onCloseAllTabs={closeAllFiles}
        onCloseUneditedTabs={closeUneditedFiles}
        onSortTabsByFileStructure={handleSortTabsByFileStructure}
        onOpenExternalFile={openExternalFile}
        onOpenWorkspaceFile={openWorkspaceFile}
        workspacePath={workspacePath}
        theme={theme}
        onToggleTheme={toggleTheme}
        openTabsCount={openFiles.length}
        showSidebar={showSidebar}
        showRightPanel={showRightPanel}
        showBottomTray={showBottomTray}
        onToggleSidebar={() => setShowSidebar(v => !v)}
        onToggleRightPanel={() => setShowRightPanel(v => !v)}
        onToggleBottomTray={() => setShowBottomTray(v => !v)}
        updateInfo={updateInfo}
        onSnoozeUpdate={snoozeUpdate}
      />

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {/* Main row: sidebar + editor + right panel */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <ActivityBar
            activeView={activeView}
            onViewChange={handleViewChange}
            gitChangeCount={gitChangeCount}
          />

          <div style={{ display: showSidebar ? 'contents' : 'none' }}>
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
              onNodeSelect={handleNodeSelect}
              expandToPath={activeFilePath}
              fileTreeRefreshKey={fileTreeRefreshKey}
              outlineContent={
                currentEditorView === 'summary' && activeFilePath
                  ? (summaryOutlineContent || null)
                  : currentEditorView === 'preview' && activeFilePath
                  ? (openFiles.find(f => f.path === activeFilePath)?.content ?? null)
                  : null
              }
              onOutlineNavigate={handleOutlineNavigate}
              activeHeadingId={activeHeadingId}
              pendingCommitMessage={pendingCommitMessage}
              onPendingCommitMessageApplied={() => setPendingCommitMessage(null)}
              onCommitSelect={setActiveCommitHash}
            />
            <ResizeDivider
              currentWidth={sidebarWidth}
              onResize={setSidebarWidth}
              min={SIDEBAR_MIN}
              max={SIDEBAR_MAX}
              side="left"
            />
          </div>

          <EditorArea
            ref={editorAreaRef}
            openFiles={openFiles}
            activeFilePath={activeFilePath}
            onTabClick={setActiveFilePath}
            onTabClose={closeFile}
            onTabReorder={reorderFiles}
            onContentChange={(path, content) => { updateContent(path, content); rightPanelRef.current?.notifyEditorActivity(); }}
            onActivity={recordAction}
            onEditorViewChange={handleEditorViewChange}
            onSummaryContentChange={setSummaryOutlineContent}
            onActiveHeadingChange={setActiveHeadingId}
            workspacePath={workspacePath}
            provider={provider}
            model={model}
            summaryRequestPath={summaryRequestPath}
            onSummaryHandled={() => setSummaryRequestPath(null)}
            onOpenFile={(path) => openFile({ path, name: path.split(/[/\\]/).pop() ?? path, type: 'file', children: null })}
            onPreviewRequest={setPreviewRequestPath}
            onSummaryRequest={setSummaryRequestPath}
            previewRequestPath={previewRequestPath}
            onPreviewHandled={() => setPreviewRequestPath(null)}
            onSummaryOpen={() => rightPanelRef.current?.openSystemView()}
            canGoBack={nav.index > 0}
            canGoForward={nav.index < nav.stack.length - 1}
            onGoBack={goBack}
            onGoForward={goForward}
            activeCommitHash={activeCommitHash}
            onCommitDiffClose={() => setActiveCommitHash(null)}
            onCommitCheckout={handleCommitCheckout}
            onCommitDiffAddToContext={(shortHash, content) => setCommitDiffContext({ shortHash, content })}
          />

          <div style={{ display: showRightPanel ? 'contents' : 'none' }}>
            <ResizeDivider
              currentWidth={effectiveRightWidth}
              onResize={(w) => { setRightPanelWidth(w); resetExpansion(); }}
              min={RIGHT_MIN}
              max={RIGHT_MAX}
              side="right"
            />
            <RightPanel
              ref={rightPanelRef}
              width={effectiveRightWidth}
              animated={panelAnimated}
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
              onNavigateToLine={handleNavigateToLine}
              onOpenUrl={handleOpenUrl}
              activeSystemNode={activeSystemNode}
              onUserTyping={startProactiveCooldown}
              onMessageSent={() => { recordAction(); startProactiveCooldown(); }}
              onAssistantBusyChange={setAssistantBusy}
              onWatchTrigger={() => { playBell(); rightPanelRef.current?.triggerPulse(); }}
              onAssistantReply={onAssistantReply}
              onFileTreeRefresh={() => setFileTreeRefreshKey(key => key + 1)}
              onSummaryRequest={handleAgentSummaryRequest}
              commitDiffContext={commitDiffContext}
              onClearCommitDiffContext={() => setCommitDiffContext(null)}
            />
          </div>
        </div>

        {/* Horizontal resize handle + bottom tray */}
        <div style={{ display: showBottomTray ? 'contents' : 'none' }}>
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
      {workspacePath && <StatusBar proactive={proactiveStatus} lastPingAt={lastPingAt} />}
    </div>
  );
}
