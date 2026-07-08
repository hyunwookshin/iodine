import { useRef, useState, useEffect } from 'react';

interface MenuBarProps {
  onOpenProject: (files: FileList) => void;
}

export function MenuBar({ onOpenProject }: MenuBarProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // webkitdirectory is a non-standard attribute; set via DOM to avoid TypeScript errors
  useEffect(() => {
    inputRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const handleOpenProjectClick = () => {
    setFileMenuOpen(false);
    inputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onOpenProject(files);
    }
    // Reset so the same directory can be re-selected
    e.target.value = '';
  };

  return (
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
      {/* Hidden directory input — webkitdirectory set via useEffect above */}
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

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
          </div>
        )}
      </div>
    </div>
  );
}
