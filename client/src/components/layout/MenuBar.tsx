import { useRef, useState } from 'react';
import { findWorkspace, openWorkspace } from '../../api/files';

interface MenuBarProps {
  onOpenProject: (path: string) => void;
  onCloseProject: () => void;
  workspacePath: string | null;
}

export function MenuBar({ onOpenProject, onCloseProject, workspacePath }: MenuBarProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

        {opening && (
          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Opening…
          </span>
        )}
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
                background: '#3c3c3c',
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
    </>
  );
}
