import { useCallback } from 'react';

interface ResizeDividerProps {
  onResize: (newSize: number) => void;
  currentWidth: number;
  min?: number;
  max?: number;
  side?: 'left' | 'right'; // which panel's width we're adjusting
  orientation?: 'vertical' | 'horizontal'; // vertical = column resize, horizontal = row resize
}

export function ResizeDivider({
  onResize,
  currentWidth,
  min = 120,
  max = 800,
  side = 'left',
  orientation = 'vertical',
}: ResizeDividerProps) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const isHorizontal = orientation === 'horizontal';
      const startPos = isHorizontal ? e.clientY : e.clientX;
      const startSize = currentWidth;

      const onMouseMove = (ev: MouseEvent) => {
        const pos = isHorizontal ? ev.clientY : ev.clientX;
        // horizontal: dragging up grows tray (top side), so invert delta
        const delta = isHorizontal
          ? startPos - pos
          : side === 'left' ? pos - startPos : startPos - pos;
        const newSize = Math.min(max, Math.max(min, startSize + delta));
        onResize(newSize);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };

      document.body.style.userSelect = 'none';
      document.body.style.cursor = isHorizontal ? 'row-resize' : 'col-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [currentWidth, min, max, onResize, side, orientation]
  );

  const isHorizontal = orientation === 'horizontal';

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        ...(isHorizontal
          ? { width: '100%', height: 4 }
          : { width: 4, height: '100%' }),
        background: 'transparent',
        cursor: isHorizontal ? 'row-resize' : 'col-resize',
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
