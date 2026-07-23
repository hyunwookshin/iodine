import { useRef, useState } from 'react';
import { findWorkspace, openWorkspace, downloadProjectMetadata, importProjectMetadata, clearProjectMetadata } from '../../api/files';
import type { Theme } from '../../hooks/useTheme';

interface MenuBarProps {
  onOpenProject: (path: string) => void;
  onCloseProject: () => void;
  onCloseAllTabs: () => void;
  onSortTabsByFileStructure: () => void;
  workspacePath: string | null;
  theme: Theme;
  onToggleTheme: () => void;
  openTabsCount: number;
}

export function MenuBar({ onOpenProject, onCloseProject, onCloseAllTabs, onSortTabsByFileStructure, workspacePath, theme, onToggleTheme, openTabsCount }: MenuBarProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [showCloseAllDialog, setShowCloseAllDialog] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectStatus, setProjectStatus] = useState<{ type: 'downloading' | 'importing' | 'clearing' | 'success' | 'error'; message: string } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleOpenProjectClick = () => {
    setFileMenuOpen(false);
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Extract root folder name from the first file's relative path
    const firstRelative = (files[0] as File & { webkitRelativePath: string }).webkitRelativePath;
    const folderName = firstRelative.split('/')[0];

    // Reset input so the same folder can be re-selected
    e.target.value = '';

    setOpening(true);
    setError(null);
    setShowFallback(false);

    try {
      const found = await findWorkspace(folderName);
      if (found.path) {
        const result = await openWorkspace(found.path);
        if (result.path) {
          onOpenProject(result.path);
          return;
        }
      }
    } catch {
      // fall through to manual input
    } finally {
      setOpening(false);
    }

    // Server couldn't locate the folder — show manual path input as fallback
    setPathInput(folderName);
    setShowFallback(true);
  };

  const handleFallbackSubmit = async () => {
    const p = pathInput.trim();
    if (!p || opening) return;
    setOpening(true);
    setError(null);
    try {
      const result = await openWorkspace(p);
      if (result.path) {
        onOpenProject(result.path);
        setShowFallback(false);
        setPathInput('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open folder');
    } finally {
      setOpening(false);
    }
  };

  const handleFallbackKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleFallbackSubmit();
    if (e.key === 'Escape') { setShowFallback(false); setPathInput(''); setError(null); }
  };

  const closeFallback = () => {
    setShowFallback(false);
    setPathInput('');
    setError(null);
  };

  const handleDownloadMetadata = async () => {
    setProjectMenuOpen(false);
    setProjectStatus({ type: 'downloading', message: 'Downloading…' });
    try {
      await downloadProjectMetadata();
      setProjectStatus({ type: 'success', message: 'Downloaded' });
      setTimeout(() => setProjectStatus(null), 3000);
    } catch (err) {
      setProjectStatus({ type: 'error', message: (err as Error).message });
      setTimeout(() => setProjectStatus(null), 6000);
    }
  };

  const handleImportMetadataClick = () => {
    setProjectMenuOpen(false);
    importInputRef.current?.click();
  };

  const handleClearMetadata = async () => {
    setShowClearConfirm(false);
    setProjectStatus({ type: 'clearing', message: 'Clearing…' });
    try {
      await clearProjectMetadata();
      setProjectStatus({ type: 'success', message: 'Metadata cleared' });
      setTimeout(() => setProjectStatus(null), 3000);
    } catch (err) {
      setProjectStatus({ type: 'error', message: (err as Error).message });
      setTimeout(() => setProjectStatus(null), 6000);
    }
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProjectStatus({ type: 'importing', message: 'Importing…' });
    try {
      await importProjectMetadata(file);
      setProjectStatus({ type: 'success', message: 'Imported successfully' });
      setTimeout(() => setProjectStatus(null), 3000);
    } catch (err) {
      setProjectStatus({ type: 'error', message: (err as Error).message });
      setTimeout(() => setProjectStatus(null), 6000);
    }
  };

  const handleCloseAllTabsClick = () => {
    if (openTabsCount === 0) {
      setEditorMenuOpen(false);
      return;
    }
    setShowCloseAllDialog(true);
  };

  const handleConfirmCloseAllTabs = () => {
    setShowCloseAllDialog(false);
    setEditorMenuOpen(false);
    onCloseAllTabs();
  };

  const handleCancelCloseAllTabs = () => {
    setShowCloseAllDialog(false);
  };

  const handleSortTabsClick = () => {
    setEditorMenuOpen(false);
    onSortTabsByFileStructure();
  };

  return (
    <>
      {/* Hidden directory picker */}
      <input
        ref={fileInputRef}
        type="file"
        // @ts-expect-error — webkitdirectory is not in React's types but works in all modern browsers
        webkitdirectory=""
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* Hidden zip import picker */}
      <input
        ref={importInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={handleImportFileChange}
      />

      <div
        style={{
          height: 30,
          background: 'var(--color-bg-sidebar)',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 4px',
          flexShrink: 0,
          zIndex: 100,
        }}
      >
        {/* File menu */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setFileMenuOpen(v => !v)}
            onBlur={() => setTimeout(() => setFileMenuOpen(false), 150)}
            style={{
              padding: '0 10px',
              height: 24,
              borderRadius: 3,
              background: fileMenuOpen ? 'var(--color-bg-hover)' : 'none',
              color: 'var(--color-text-primary)',
              fontSize: 13,
            }}
            onMouseEnter={e => { if (!fileMenuOpen) e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
            onMouseLeave={e => { if (!fileMenuOpen) e.currentTarget.style.background = 'none'; }}
          >
            File
          </button>

          {fileMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 2,
                background: 'var(--color-bg-sidebar)',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                padding: '4px 0',
                minWidth: 180,
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                zIndex: 200,
              }}
            >
              <button
                onMouseDown={handleOpenProjectClick}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '5px 16px',
                  textAlign: 'left',
                  color: 'var(--color-text-primary)',
                  fontSize: 13,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-selected)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                Open Project…
              </button>

              {workspacePath && (
                <>
                  <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />
                  <button
                    onMouseDown={() => { setFileMenuOpen(false); onCloseProject(); }}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '5px 16px',
                      textAlign: 'left',
                      color: 'var(--color-text-primary)',
                      fontSize: 13,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-selected)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    Close Project
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Editor menu */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setEditorMenuOpen(v => !v)}
            onBlur={() => setTimeout(() => setEditorMenuOpen(false), 150)}
            style={{
              padding: '0 10px',
              height: 24,
              borderRadius: 3,
              background: editorMenuOpen ? 'var(--color-bg-hover)' : 'none',
              color: 'var(--color-text-primary)',
              fontSize: 13,
            }}
            onMouseEnter={e => { if (!editorMenuOpen) e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
            onMouseLeave={e => { if (!editorMenuOpen) e.currentTarget.style.background = 'none'; }}
          >
            Editor
          </button>

          {editorMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 2,
                background: 'var(--color-bg-sidebar)',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                padding: '4px 0',
                minWidth: 220,
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                zIndex: 200,
              }}
            >
              <button
                onMouseDown={handleCloseAllTabsClick}
                disabled={openTabsCount === 0}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '5px 16px',
                  textAlign: 'left',
                  color: openTabsCount === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
                  fontSize: 13,
                  cursor: openTabsCount === 0 ? 'default' : 'pointer',
                }}
                onMouseEnter={e => { if (openTabsCount > 0) e.currentTarget.style.background = 'var(--color-bg-selected)'; }}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                Close All Tabs
              </button>

              <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />

              <button
                onMouseDown={handleSortTabsClick}
                disabled={openTabsCount === 0}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '5px 16px',
                  textAlign: 'left',
                  color: openTabsCount === 0 ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
                  fontSize: 13,
                  cursor: openTabsCount === 0 ? 'default' : 'pointer',
                }}
                onMouseEnter={e => { if (openTabsCount > 0) e.currentTarget.style.background = 'var(--color-bg-selected)'; }}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                Sort Tabs by File Structure
              </button>
            </div>
          )}
        </div>

        {/* Project menu — only visible when a workspace is open */}
        {workspacePath && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setProjectMenuOpen(v => !v)}
              onBlur={() => setTimeout(() => setProjectMenuOpen(false), 150)}
              style={{
                padding: '0 10px',
                height: 24,
                borderRadius: 3,
                background: projectMenuOpen ? 'var(--color-bg-hover)' : 'none',
                color: 'var(--color-text-primary)',
                fontSize: 13,
              }}
              onMouseEnter={e => { if (!projectMenuOpen) e.currentTarget.style.background = 'var(--color-bg-hover)'; }}
              onMouseLeave={e => { if (!projectMenuOpen) e.currentTarget.style.background = 'none'; }}
            >
              Project
            </button>

            {projectMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 2,
                  background: 'var(--color-bg-sidebar)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4,
                  padding: '4px 0',
                  minWidth: 200,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                  zIndex: 200,
                }}
              >
                {([
                  { label: 'Download Metadata', action: handleDownloadMetadata },
                  { label: 'Import Metadata…',  action: handleImportMetadataClick },
                  { label: 'Clear Metadata',    action: () => { setProjectMenuOpen(false); setShowClearConfirm(true); } },
                ]).map(item => (
                  <button
                    key={item.label}
                    onMouseDown={item.action}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '5px 16px',
                      textAlign: 'left',
                      color: 'var(--color-text-primary)',
                      fontSize: 13,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-selected)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {opening && (
          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Opening…
          </span>
        )}

        {projectStatus && (
          <span style={{
            marginLeft: 8,
            fontSize: 12,
            color: projectStatus.type === 'error' ? '#f48771'
                 : projectStatus.type === 'success' ? '#89d185'
                 : 'var(--color-text-secondary)',
          }}>
            {projectStatus.message}
          </span>
        )}

        <div style={{ flex: 1 }} />
        <button
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          style={{
            width: 28,
            height: 24,
            borderRadius: 3,
            color: 'var(--color-text-primary)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>

      {/* Fallback: manual path input shown when auto-detect fails */}
      {showFallback && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
          }}
          onClick={e => { if (e.target === e.currentTarget) closeFallback(); }}
        >
          <div
            style={{
              background: 'var(--color-bg-sidebar)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: '20px 24px',
              width: 420,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>
              Open Project
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
              Could not locate <strong style={{ color: 'var(--color-text-primary)' }}>{pathInput.split('/').pop() || pathInput}</strong> automatically.
              Enter the absolute path:
            </div>
            <input
              autoFocus
              type="text"
              value={pathInput}
              onChange={e => setPathInput(e.target.value)}
              onKeyDown={handleFallbackKeyDown}
              placeholder="/absolute/path/to/project"
              style={{
                width: '100%',
                background: 'var(--color-bg-input)',
                border: '1px solid var(--color-accent)',
                borderRadius: 3,
                color: 'var(--color-text-primary)',
                padding: '6px 8px',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {error && (
              <div style={{ marginTop: 6, color: '#f48771', fontSize: 12 }}>{error}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button
                onClick={closeFallback}
                style={{
                  padding: '5px 14px',
                  borderRadius: 3,
                  color: 'var(--color-text-secondary)',
                  background: 'var(--color-bg-hover)',
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleFallbackSubmit}
                disabled={!pathInput.trim() || opening}
                style={{
                  padding: '5px 14px',
                  borderRadius: 3,
                  background: !pathInput.trim() || opening ? '#ffffff18' : 'var(--color-accent)',
                  color: !pathInput.trim() || opening ? 'var(--color-text-secondary)' : '#fff',
                  cursor: !pathInput.trim() || opening ? 'default' : 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {opening ? 'Opening…' : 'Open'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close All Tabs confirmation dialog */}
      {showCloseAllDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
          }}
          onClick={e => { if (e.target === e.currentTarget) handleCancelCloseAllTabs(); }}
        >
          <div
            style={{
              background: 'var(--color-bg-sidebar)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: '20px 24px',
              width: 420,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>
              Close All Tabs
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
              Are you sure you want to close all {openTabsCount} tab{openTabsCount !== 1 ? 's' : ''}?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={handleCancelCloseAllTabs}
                style={{
                  padding: '6px 16px',
                  borderRadius: 3,
                  color: 'var(--color-text-secondary)',
                  background: 'var(--color-bg-hover)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-selected)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmCloseAllTabs}
                style={{
                  padding: '6px 16px',
                  borderRadius: 3,
                  background: 'var(--color-accent)',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                Close All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Metadata confirmation dialog */}
      {showClearConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.5)',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowClearConfirm(false); }}
        >
          <div
            style={{
              background: 'var(--color-bg-sidebar)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: '20px 24px',
              width: 380,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>
              Clear Metadata
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
              This will delete all cached AI summaries and build config for this workspace. This cannot be undone.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setShowClearConfirm(false)}
                style={{
                  padding: '6px 16px', borderRadius: 3, fontSize: 13, cursor: 'pointer',
                  color: 'var(--color-text-secondary)', background: 'var(--color-bg-hover)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-selected)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
              >
                Cancel
              </button>
              <button
                onClick={handleClearMetadata}
                style={{
                  padding: '6px 16px', borderRadius: 3, fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', background: '#c53030', border: '1px solid #c53030', color: '#fff',
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
