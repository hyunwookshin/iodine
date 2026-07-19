import type { OpenFile } from '../../types';

interface EditorTabsProps {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  onTabClick: (path: string) => void;
  onTabClose: (path: string) => void;
}

export function EditorTabs({ openFiles, activeFilePath, onTabClick, onTabClose }: EditorTabsProps) {
  if (openFiles.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        height: 'var(--tab-height)',
        background: 'var(--color-bg-tab-inactive)',
        borderBottom: '1px solid var(--color-border)',
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
      }}
    >
      {openFiles.map(file => {
        const isActive = file.path === activeFilePath;

        return (
          <div
            key={file.path}
            onClick={() => onTabClick(file.path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 8px 0 12px',
              height: '100%',
              minWidth: 80,
              maxWidth: 200,
              cursor: 'pointer',
              background: isActive ? 'var(--color-bg-tab-active)' : 'var(--color-bg-tab-inactive)',
              borderTop: isActive ? '1px solid var(--color-accent)' : '1px solid transparent',
              borderRight: '1px solid var(--color-border)',
              color: isActive ? 'var(--color-text-active)' : 'var(--color-text-secondary)',
              userSelect: 'none',
              flexShrink: 0,
              position: 'relative',
            }}
            onMouseEnter={e => {
              if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-hover)';
              const closeBtn = e.currentTarget.querySelector('.close-btn') as HTMLElement;
              const dirtyDot = e.currentTarget.querySelector('.dirty-dot') as HTMLElement;
              if (closeBtn) closeBtn.style.display = 'flex';
              if (dirtyDot) dirtyDot.style.display = 'none';
            }}
            onMouseLeave={e => {
              if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-bg-tab-inactive)';
              const closeBtn = e.currentTarget.querySelector('.close-btn') as HTMLElement;
              const dirtyDot = e.currentTarget.querySelector('.dirty-dot') as HTMLElement;
              if (closeBtn) closeBtn.style.display = 'none';
              if (dirtyDot && file.isDirty) dirtyDot.style.display = 'block';
            }}
          >
            {/* Icon + name */}
            {file.isDirectory && (
              <span style={{ fontSize: 12, flexShrink: 0 }}>📁</span>
            )}
            <span
              style={{
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                fontStyle: file.isDirectory ? 'italic' : 'normal',
              }}
            >
              {file.name}
            </span>

            {/* Dirty indicator + close button (share the same slot) */}
            <div style={{ width: 16, height: 16, position: 'relative', flexShrink: 0 }}>
              {/* Dirty dot */}
              {file.isDirty && (
                <div
                  className="dirty-dot"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--color-dirty-dot)',
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              )}

              {/* Close button (hidden by default, shown on hover) */}
              <button
                className="close-btn"
                onClick={e => {
                  e.stopPropagation();
                  onTabClose(file.path);
                }}
                title="Close"
                style={{
                  display: 'none',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 16,
                  height: 16,
                  borderRadius: 3,
                  color: 'var(--color-text-secondary)',
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
                onMouseEnter={e => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLButtonElement).style.background = '#ffffff20';
                  (e.currentTarget as HTMLButtonElement).style.color = '#fff';
                }}
                onMouseLeave={e => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)';
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
