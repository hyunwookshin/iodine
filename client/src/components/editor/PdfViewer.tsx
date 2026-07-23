import { useState } from 'react';
import { getPdfUrl } from '../../api/files';

interface PdfViewerProps {
  path: string;
  name: string;
}

export function PdfViewer({ path, name }: PdfViewerProps) {
  const [error, setError] = useState(false);

  const src = getPdfUrl(path);

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
      </div>

      {/* PDF viewer */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          boxSizing: 'border-box',
        }}
      >
        {error ? (
          <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
            Failed to load PDF.
          </div>
        ) : (
          <iframe
            src={src}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              borderRadius: 4,
            }}
            title={name}
            onError={() => setError(true)}
          />
        )}
      </div>
    </div>
  );
}
