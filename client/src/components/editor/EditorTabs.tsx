import { useRef, useState } from 'react';
import type { OpenFile } from '../../types';

interface EditorTabsProps {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  onTabClick: (path: string) => void;
  onTabClose: (path: string) => void;
  onTabReorder?: (fromIndex: number, toIndex: number) => void;
}

export function EditorTabs({ openFiles, activeFilePath, onTabClick, onTabClose, onTabReorder }: EditorTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  if (openFiles.length === 0) return null;

  // Convert vertical mouse-wheel scrolling into horizontal scrolling over the tab strip.
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    // Only hijack the wheel when there's actually horizontal overflow and the
    // gesture is predominantly vertical (typical mouse wheel).
    if (el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      style={{
        display: 'flex',
        height: 'var(--tab-height)',
        background: 'var(--color-bg-tab-inactive)',
        borderBottom: '1px solid var(--color-border)',
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
        scrollbarWidth: 'thin',
      }}
    >
      {openFiles.map((file, index) => {
        const isActive = file.path === activeFilePath;
        const isDragOver = dragOverIndex === index;

        return (
          <div
            key={file.path}
            draggable
            onClick={() => onTabClick(file.path)}
            onDragStart={e => {
              dragIndexRef.current = index;
              e.dataTransfer.effectAllowed = 'move';
              // Firefox requires data to be set for drag to initiate
              e.dataTransfer.setData('text/plain', file.path);
            }}
            onDragOver={e => {
              e.preventDefault();
              if (dragIndexRef.current === null || dragIndexRef.current === index) return;
              setDragOverIndex(index);
            }}
            onDragLeave={() => {
              setDragOverIndex(current => (current === index ? null : current));
            }}
            onDrop={e => {
              e.preventDefault();
              const fromIndex = dragIndexRef.current;
              dragIndexRef.current = null;
              setDragOverIndex(null);
              if (fromIndex === null || fromIndex === index) return;
              onTabReorder?.(fromIndex, index);
            }}
            onDragEnd={() => {
              dragIndexRef.current = null;
              setDragOverIndex(null);
            }}
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
              borderLeft: isDragOver ? '2px solid var(--color-accent)' : 'none',
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
