import { useCallback } from 'react';

interface ResizeDividerProps {
  onResize: (newWidth: number) => void;
  currentWidth: number;
  min?: number;
  max?: number;
  side?: 'left' | 'right'; // which panel's width we're adjusting
}

export function ResizeDivider({
  onResize,
  currentWidth,
  min = 120,
  max = 800,
  side = 'left',
}: ResizeDividerProps) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = currentWidth;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = side === 'left'
          ? ev.clientX - startX
          : startX - ev.clientX;
        const newWidth = Math.min(max, Math.max(min, startWidth + delta));
        onResize(newWidth);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [currentWidth, min, max, onResize, side]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        width: 4,
        background: 'transparent',
        cursor: 'col-resize',
        flexShrink: 0,
        transition: 'background 0.1s',
        zIndex: 10,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.background = 'var(--color-accent)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    />
  );
}
