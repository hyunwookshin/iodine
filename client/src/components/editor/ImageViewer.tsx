import { useState } from 'react';
import { getImageUrl } from '../../api/files';

interface ImageViewerProps {
  path: string;
  name: string;
}

export function ImageViewer({ path, name }: ImageViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);

  const src = getImageUrl(path);

  const zoomIn  = () => setZoom(z => Math.min(z + 0.25, 5));
  const zoomOut = () => setZoom(z => Math.max(z - 0.25, 0.25));
  const reset   = () => setZoom(1);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-bg-editor)',
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-tab-inactive)',
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', flex: 1 }}>
          {name}
        </span>
        <button onClick={zoomOut} title="Zoom out" style={btnStyle}>−</button>
        <span
          onClick={reset}
          title="Reset zoom"
          style={{ fontSize: 12, color: 'var(--color-text-secondary)', minWidth: 44, textAlign: 'center', cursor: 'pointer' }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={zoomIn} title="Zoom in" style={btnStyle}>+</button>
      </div>

      {/* Image canvas */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          alignItems: zoom <= 1 ? 'center' : 'flex-start',
          justifyContent: zoom <= 1 ? 'center' : 'flex-start',
          padding: 24,
          boxSizing: 'border-box',
        }}
      >
        {error ? (
          <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
            Failed to load image.
          </div>
        ) : (
          <img
            src={src}
            alt={name}
            onError={() => setError(true)}
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              imageRendering: zoom > 2 ? 'pixelated' : 'auto',
              maxWidth: zoom <= 1 ? '100%' : 'none',
              maxHeight: zoom <= 1 ? '100%' : 'none',
              display: 'block',
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
              borderRadius: 4,
            }}
          />
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  fontWeight: 700,
  background: 'transparent',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  lineHeight: 1,
  padding: 0,
};
