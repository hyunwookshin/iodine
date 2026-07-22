import { forwardRef, useImperativeHandle, useState, useEffect, useCallback, useRef } from 'react';
import type { editor as MonacoEditorAPI } from 'monaco-editor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EditorTabs } from '../editor/EditorTabs';
import { MonacoEditor } from '../editor/MonacoEditor';
import { WelcomeScreen } from '../editor/WelcomeScreen';
import { ImageViewer } from '../editor/ImageViewer';
import { useFileDiff } from '../../hooks/useFileDiff';
import type { OpenFile } from '../../types';
import type { Provider } from '../../providers';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

type EditorView = 'source' | 'preview' | 'summary';

interface EditorAreaProps {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  onTabClick: (path: string) => void;
  onTabClose: (path: string) => void;
  onTabReorder?: (fromIndex: number, toIndex: number) => void;
  onContentChange: (path: string, content: string) => void;
  workspacePath: string | null;
  provider: Provider;
  model: string;
  /** When set to the active file's path, the editor switches to the AI summary view. */
  summaryRequestPath?: string | null;
  /** Called once the summary request has been consumed. */
  onSummaryHandled?: () => void;
}

export interface EditorAreaHandle {
  save: () => void;
  getVisibleContext: () => string | null;
}

function isPreviewable(path: string) {
  return path.endsWith('.md') || path.endsWith('.html');
}

/** Resolve a potentially relative image src to an API URL that the server can serve. */
function resolveImageSrc(src: string, activeFilePath: string | null): string {
  if (/^https?:\/\//.test(src) || src.startsWith('data:')) return src;
  if (!activeFilePath) return src;
  const dir = activeFilePath.substring(0, activeFilePath.lastIndexOf('/'));
  const parts = `${dir}/${src}`.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  }
  return `http://localhost:3001/api/files/image?path=${encodeURIComponent(resolved.join('/'))}`;
}

const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.03em',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  userSelect: 'none',
  boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
};

export const EditorArea = forwardRef<EditorAreaHandle, EditorAreaProps>(
  function EditorArea({ openFiles, activeFilePath, onTabClick, onTabClose, onTabReorder, onContentChange, workspacePath, provider, model, summaryRequestPath, onSummaryHandled }, ref) {
    const activeFile = openFiles.find(f => f.path === activeFilePath) ?? null;
    const diffData   = useFileDiff(activeFile?.isImage ? null : (activeFile?.path ?? null));
    const monacoEditorRef = useRef<MonacoEditorAPI.IStandaloneCodeEditor | null>(null);

    const [editorView,       setEditorView]       = useState<EditorView>('source');
    const [summaryContent,   setSummaryContent]   = useState('');
    const [summaryLoading,   setSummaryLoading]   = useState(false);
    const [summaryError,     setSummaryError]     = useState<string | null>(null);
    const [hasCachedSummary, setHasCachedSummary] = useState(false);

    // Reset view & summary when switching files; directories go straight to summary view
    useEffect(() => {
      setEditorView(activeFile?.isDirectory ? 'summary' : 'source');
      setSummaryContent('');
      setSummaryError(null);
      setSummaryLoading(false);
      setHasCachedSummary(false);
    }, [activeFile?.path]);

    // Probe cache whenever the active file/dir changes so the button label is accurate
    useEffect(() => {
      if (!activeFile || activeFile.isImage || !workspacePath) return;
      const relPath = activeFile.path.startsWith(workspacePath + '/')
        ? activeFile.path.slice(workspacePath.length + 1)
        : activeFile.path;
      const url = activeFile.isDirectory
        ? `${API_BASE}/api/ai-directory-summary?path=${encodeURIComponent(relPath)}`
        : `${API_BASE}/api/ai-summary?path=${encodeURIComponent(relPath)}`;
      fetch(url)
        .then(r => r.json())
        .then((data: { content: string | null }) => setHasCachedSummary(!!data.content))
        .catch(() => {});
    }, [activeFile?.path, workspacePath]);

    // Honor an external request to show the AI summary for the active file.
    // Switching the view to 'summary' with empty content triggers the
    // generation/cache-load effect below.
    useEffect(() => {
      if (!summaryRequestPath || !activeFile) return;
      if (activeFile.path !== summaryRequestPath) return;
      setEditorView('summary');
      onSummaryHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [summaryRequestPath, activeFile?.path]);

    useImperativeHandle(ref, () => ({
      save: () => {},
      getVisibleContext: () => {
        const editor = monacoEditorRef.current;
        if (!editor) return null;
        const model = editor.getModel();
        if (!model) return null;
        const fileName = activeFile?.name ?? '';

        // Prefer selected text
        const selection = editor.getSelection();
        if (selection && !selection.isEmpty()) {
          const startLine = selection.startLineNumber;
          const endLine = selection.endLineNumber;
          const lines: string[] = [];
          for (let i = startLine; i <= endLine; i++) {
            lines.push(`${i}: ${model.getLineContent(i)}`);
          }
          return `File: ${fileName} (selected lines ${startLine}-${endLine})\n${lines.join('\n')}`;
        }

        // Fall back to visible range
        const ranges = editor.getVisibleRanges();
        if (!ranges.length) return null;
        const range = ranges[0];
        const startLine = range.startLineNumber;
        const endLine = range.endLineNumber;
        const lines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
          lines.push(`${i}: ${model.getLineContent(i)}`);
        }
        return `File: ${fileName} (visible lines ${startLine}-${endLine})\n${lines.join('\n')}`;
      },
    }));

    const showPreviewButton = !!activeFile && !activeFile.isImage && !activeFile.isDirectory && isPreviewable(activeFile.path);
    const showSummaryButton = !!activeFile && !activeFile.isImage && !activeFile.isDirectory && !!workspacePath && !activeFile.path.endsWith('.md');

    /** Convert an absolute file path to a workspace-relative path. */
    const toRelPath = (abs: string) =>
      workspacePath && abs.startsWith(workspacePath + '/')
        ? abs.slice(workspacePath.length + 1)
        : abs;

    const handleSwitchToSummary = useCallback(async () => {
      if (!activeFile || !workspacePath) return;
      setEditorView('summary');

      // If we already have content for this session, just show it
      if (summaryContent) return;

      setSummaryLoading(true);
      setSummaryError(null);

      const relPath = toRelPath(activeFile.path);
      const isDir = !!activeFile.isDirectory;

      // 1. Check cache
      try {
        const cacheUrl = isDir
          ? `${API_BASE}/api/ai-directory-summary?path=${encodeURIComponent(relPath)}`
          : `${API_BASE}/api/ai-summary?path=${encodeURIComponent(relPath)}`;
        const resp = await fetch(cacheUrl);
        const data = await resp.json() as { content: string | null };
        if (data.content) {
          setSummaryContent(data.content);
          setSummaryLoading(false);
          return;
        }
      } catch { /* fall through to generation */ }

      // 2. Generate via SSE
      try {
        const generateUrl = isDir
          ? `${API_BASE}/api/ai-directory-summary/generate`
          : `${API_BASE}/api/ai-summary/generate`;
        const generateBody = isDir
          ? JSON.stringify({ dirPath: relPath, provider: provider.id, model })
          : JSON.stringify({ filePath: relPath, provider: provider.id, model });
        const resp = await fetch(generateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: generateBody,
        });

        if (!resp.ok || !resp.body) {
          setSummaryError('Failed to start generation');
          setSummaryLoading(false);
          return;
        }

        const reader  = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            let eventName = '', dataStr = '';
            for (const line of part.split('\n')) {
              if (line.startsWith('event: ')) eventName = line.slice(7).trim();
              else if (line.startsWith('data: ')) dataStr  = line.slice(6).trim();
            }
            if (!dataStr) continue;
            try {
              const payload = JSON.parse(dataStr) as Record<string, unknown>;
              if (eventName === 'text_delta') {
                setSummaryContent(c => c + (payload.text as string));
              } else if (eventName === 'done') {
                setSummaryLoading(false);
                setHasCachedSummary(true);
              } else if (eventName === 'error') {
                setSummaryError(payload.message as string);
                setSummaryLoading(false);
              }
            } catch { /* skip malformed */ }
          }
        }
      } catch (e) {
        setSummaryError((e as Error).message);
        setSummaryLoading(false);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeFile, workspacePath, provider, model, summaryContent]);

    const handleRegenerateSummary = useCallback(() => {
      setSummaryContent('');
      setSummaryError(null);
      // handleSwitchToSummary will re-run once summaryContent is cleared
      // but we're already in summary view, so call it directly
      setSummaryLoading(false); // reset so the effect triggers
    }, []);

    // Re-trigger generation after clearing content (for regenerate)
    useEffect(() => {
      if (editorView === 'summary' && !summaryContent && !summaryLoading && !summaryError) {
        handleSwitchToSummary();
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [summaryContent, summaryLoading, editorView]);

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
          onTabReorder={onTabReorder}
        />
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>

          {/* ── Floating button group (bottom-right) ── */}
          {(showPreviewButton || showSummaryButton) && (
            <div style={{
              position: 'absolute', bottom: 20, right: 20, zIndex: 10,
              display: 'flex', gap: 6,
            }}>
              {/* Preview toggle — only for .md / .html */}
              {showPreviewButton && editorView !== 'summary' && (
                <button
                  onClick={() => setEditorView(v => v === 'preview' ? 'source' : 'preview')}
                  title={editorView === 'preview' ? 'Switch to source' : 'Switch to preview'}
                  style={{ ...btnStyle, background: editorView === 'preview' ? '#007acc' : '#3a3d41' }}
                >
                  {editorView === 'preview' ? '⌨ Source' : '👁 Preview'}
                </button>
              )}

              {/* AI Summary toggle */}
              {showSummaryButton && (
                <button
                  onClick={() => editorView === 'summary'
                    ? setEditorView('source')
                    : handleSwitchToSummary()}
                  title={editorView === 'summary' ? 'Back to source' : hasCachedSummary ? 'View cached summary' : 'Generate AI summary'}
                  style={{ ...btnStyle, background: editorView === 'summary' ? '#007acc' : '#3a3d41' }}
                >
                  {editorView === 'summary' ? '⌨ Source' : hasCachedSummary ? '📖 View Summary' : '✨ Generate Summary'}
                </button>
              )}
            </div>
          )}

          {/* ── Content area ── */}
          {activeFile ? (
            activeFile.isImage ? (
              <ImageViewer path={activeFile.path} name={activeFile.name} />

            ) : editorView === 'summary' ? (
              /* AI Summary view */
              <div
                className="md-preview"
                style={{
                  height: '100%', overflow: 'auto',
                  padding: '24px 32px',
                  color: 'var(--color-text-primary)',
                  fontSize: 14, lineHeight: 1.7,
                  boxSizing: 'border-box',
                }}
              >
                {/* Header row */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 16, gap: 8,
                }}>
                  <span style={{
                    fontSize: 11, color: 'var(--color-text-secondary)',
                    fontFamily: 'monospace',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    {activeFile.isDirectory && <span style={{ fontSize: 13 }}>📁</span>}
                    {toRelPath(activeFile.path)}
                    {activeFile.isDirectory && <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'sans-serif', fontStyle: 'italic' }}> — directory summary</span>}
                  </span>
                  {!summaryLoading && (summaryContent || summaryError) && (
                    <button
                      onClick={handleRegenerateSummary}
                      title="Regenerate summary"
                      style={{
                        background: 'none', border: '1px solid var(--color-border)',
                        borderRadius: 4, color: 'var(--color-text-secondary)',
                        fontSize: 11, padding: '2px 8px', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      ↺ Regenerate
                    </button>
                  )}
                </div>

                {/* Spinner */}
                {summaryLoading && !summaryContent && (
                  <div style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic', fontSize: 13 }}>
                    Generating summary…
                  </div>
                )}

                {/* Error */}
                {summaryError && (
                  <div style={{
                    padding: '8px 12px', background: '#f487710a',
                    color: '#f48771', borderRadius: 4, fontSize: 12, marginBottom: 12,
                  }}>
                    {summaryError}
                  </div>
                )}

                {/* Streaming / cached markdown */}
                {summaryContent && (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {summaryContent}
                  </ReactMarkdown>
                )}
              </div>

            ) : editorView === 'preview' && isPreviewable(activeFile.path) ? (
              /* Markdown / HTML preview */
              activeFile.path.endsWith('.md') ? (
                <div
                  className="md-preview"
                  style={{
                    height: '100%', overflow: 'auto',
                    padding: '24px 32px',
                    color: 'var(--color-text-primary)',
                    fontSize: 14, lineHeight: 1.7,
                    boxSizing: 'border-box',
                  }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      img({ src, alt, ...props }) {
                        const resolvedSrc = resolveImageSrc(src ?? '', activeFile.path);
                        return <img src={resolvedSrc} alt={alt ?? ''} {...props} style={{ maxWidth: '100%' }} />;
                      },
                    }}
                  >
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

            ) : activeFile.isDirectory ? null : (
              /* Monaco source editor */
              <MonacoEditor
                key={activeFile.path}
                file={activeFile}
                onContentChange={onContentChange}
                diffData={diffData}
                onEditorMount={editor => { monacoEditorRef.current = editor; }}
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
