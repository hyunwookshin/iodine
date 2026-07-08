import { forwardRef, useImperativeHandle, useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EditorTabs } from '../editor/EditorTabs';
import { MonacoEditor } from '../editor/MonacoEditor';
import { WelcomeScreen } from '../editor/WelcomeScreen';
import { useFileDiff } from '../../hooks/useFileDiff';
import type { OpenFile } from '../../types';

interface EditorAreaProps {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  onTabClick: (path: string) => void;
  onTabClose: (path: string) => void;
  onContentChange: (path: string, content: string) => void;
}

export interface EditorAreaHandle {
  save: () => void;
}

function isPreviewable(path: string) {
  return path.endsWith('.md') || path.endsWith('.html');
}

export const EditorArea = forwardRef<EditorAreaHandle, EditorAreaProps>(
  function EditorArea({ openFiles, activeFilePath, onTabClick, onTabClose, onContentChange }, ref) {
    const activeFile = openFiles.find(f => f.path === activeFilePath) ?? null;
    const diffData = useFileDiff(activeFile?.path ?? null);
    const [preview, setPreview] = useState(false);

    // Reset to source mode when switching to a non-previewable file
    useEffect(() => {
      if (!activeFile || !isPreviewable(activeFile.path)) setPreview(false);
    }, [activeFile?.path]);

    useImperativeHandle(ref, () => ({
      save: () => {
        // Save is handled by WorkbenchLayout via saveFile hook
      },
    }));

    const showToggle = !!activeFile && isPreviewable(activeFile.path);

    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--color-bg-editor)',
          minWidth: 0,
        }}
      >
        <EditorTabs
          openFiles={openFiles}
          activeFilePath={activeFilePath}
          onTabClick={onTabClick}
          onTabClose={onTabClose}
        />
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {showToggle && (
            <button
              onClick={() => setPreview(v => !v)}
              title={preview ? 'Switch to source' : 'Switch to preview'}
              style={{
                position: 'absolute',
                bottom: 20,
                right: 20,
                zIndex: 10,
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.03em',
                background: preview ? '#007acc' : '#3a3d41',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                userSelect: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              }}
            >
              {preview ? '⌨ Source' : '👁 Preview'}
            </button>
          )}

          {activeFile ? (
            preview && isPreviewable(activeFile.path) ? (
              activeFile.path.endsWith('.md') ? (
                <div
                  className="md-preview"
                  style={{
                    height: '100%',
                    overflow: 'auto',
                    padding: '24px 32px',
                    color: '#d4d4d4',
                    fontSize: 14,
                    lineHeight: 1.7,
                    boxSizing: 'border-box',
                  }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {activeFile.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <iframe
                  srcDoc={activeFile.content}
                  sandbox="allow-scripts"
                  style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                  title="HTML preview"
                />
              )
            ) : (
              <MonacoEditor
                key={activeFile.path}
                file={activeFile}
                onContentChange={onContentChange}
                diffData={diffData}
              />
            )
          ) : (
            <WelcomeScreen />
          )}
        </div>
      </div>
    );
  }
);
