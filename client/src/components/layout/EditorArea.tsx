import React, { forwardRef, useImperativeHandle, useState, useEffect, useCallback, useRef } from 'react';
import type { editor as MonacoEditorAPI } from 'monaco-editor';
import { MarkdownRenderer } from '../editor/MarkdownRenderer';
import { useSummary } from '../../hooks/useSummary';
import { resolveWorkspacePath } from '../editor/MarkdownUtils';
import { EditorTabs } from '../editor/EditorTabs';
import { MonacoEditor } from '../editor/MonacoEditor';
import { WelcomeScreen } from '../editor/WelcomeScreen';
import { ImageViewer } from '../editor/ImageViewer';
import { PdfViewer } from '../editor/PdfViewer';
import MergeConflictView from '../editor/MergeConflictView';
import { CommitDiffView } from '../editor/CommitDiffView';
import { FilePathLink } from '../editor/FilePathLink';
import { useFileDiff } from '../../hooks/useFileDiff';
import { hasConflictMarkers } from '../../utils/mergeConflict';
import { looksLikePath } from '../../utils/filePath';
import type { OpenFile } from '../../types';
import type { Provider } from '../../providers';

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

type EditorView = 'source' | 'preview' | 'summary' | 'conflicts';

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
  /** Fired on editor scroll — forwarded to MonacoEditor for activity tracking. */
  onActivity?: () => void;
  /** Called whenever the editor view switches between source / preview / summary. */
  onEditorViewChange?: (view: string) => void;
  /** Called whenever the AI summary text changes (streaming or cached load), so the
   *  parent can feed it to the outline panel without duplicating summary state. */
  onSummaryContentChange?: (content: string) => void;
  /** Called as the user scrolls preview/summary, reporting the heading currently at the top. */
  onActiveHeadingChange?: (id: string | null) => void;
  /** Called when a relative markdown link points to a file not yet open — should open it as a tab. */
  onOpenFile?: (path: string) => void;
  /** Called when a markdown link navigates to another .md file — parent should set previewRequestPath. */
  onPreviewRequest?: (path: string) => void;
  /** Called when a wiki-link target has a cached AI summary — parent should set summaryRequestPath. */
  onSummaryRequest?: (path: string) => void;
  /** When set to a file path, switches that file to preview once it becomes active. */
  previewRequestPath?: string | null;
  /** Called once the preview request has been consumed. */
  onPreviewHandled?: () => void;
  /** Called whenever the user opens the AI summary view (generate or view cached). */
  onSummaryOpen?: () => void;
  /** Whether the navigation stack has a previous entry to go back to. */
  canGoBack?: boolean;
  /** Whether the navigation stack has a forward entry. */
  canGoForward?: boolean;
  /** Navigate back in the file history stack. */
  onGoBack?: () => void;
  /** Navigate forward in the file history stack. */
  onGoForward?: () => void;
  /** When set, show the commit diff overlay for this hash. */
  activeCommitHash?: string | null;
  /** Called when the commit diff overlay is closed. */
  onCommitDiffClose?: () => void;
  /** Called when the user clicks "Checkout" in the commit diff overlay. */
  onCommitCheckout?: (hash: string) => void;
  /** Called when the user clicks "+ Ask Assistant" in the commit diff overlay. */
  onCommitDiffAddToContext?: (shortHash: string, content: string) => void;
}

export interface EditorAreaHandle {
  save: () => void;
  getVisibleContext: () => string | null;
  navigateToLine: (filePath: string, line: number, endLine?: number, startCol?: number, endCol?: number) => void;
  scrollToHeading: (id: string) => void;
}

function isPreviewable(path: string) {
  return path.endsWith('.md') || path.endsWith('.html');
}

/* Markdown path and heading helpers live in editor/MarkdownUtils.ts. */

const btnStyle: React.CSSProperties = {
  width: 180,
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.03em',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
};

export const EditorArea = forwardRef<EditorAreaHandle, EditorAreaProps>(
  function EditorArea({ openFiles, activeFilePath, onTabClick, onTabClose, onTabReorder, onContentChange, workspacePath, provider, model, summaryRequestPath, onSummaryHandled, onActivity, onEditorViewChange, onSummaryContentChange, onActiveHeadingChange, onOpenFile, onPreviewRequest, previewRequestPath, onPreviewHandled, onSummaryRequest, onSummaryOpen, canGoBack, canGoForward, onGoBack, onGoForward, activeCommitHash, onCommitDiffClose, onCommitCheckout, onCommitDiffAddToContext }, ref) {
    const activeFile = openFiles.find(f => f.path === activeFilePath) ?? null;
    const { diff: diffData, refreshDiff } = useFileDiff(
      (activeFile?.isImage || activeFile?.isUrl || activeFile?.isExternal) ? null : (activeFile?.path ?? null),
      activeFile?.content ?? '',
    );
    const monacoEditorRef = useRef<MonacoEditorAPI.IStandaloneCodeEditor | null>(null);
    const scrollPercentageRef = useRef(0);
    const previousViewRef = useRef<EditorView>('source');
    const previewRef = useRef<HTMLDivElement | null>(null);
    const summaryRef = useRef<HTMLDivElement | null>(null);
    // Suppresses scroll-based heading tracking briefly after a programmatic scrollToHeading
    // so the outline doesn't jerk through intermediate positions during smooth scroll.
    const suppressTrackingUntilRef = useRef(0);

    const [editorView, setEditorView] = useState<EditorView>('source');
    const [isFolded, setIsFolded] = useState(false);

    // Pending navigation request: open a file at a line and highlight a range.
    // Stored in a ref so it can be applied when the Monaco editor mounts for the target file.
    const pendingNavigationRef = useRef<{ filePath: string; line: number; endLine: number; startCol?: number; endCol?: number } | null>(null);
    const decorationIdsRef = useRef<string[]>([]);
    // Remembers the last editor view per file path so navigating back restores it.
    const viewByPathRef = useRef<Map<string, EditorView>>(new Map());
    // Remembers the scroll position (0–1 ratio) per file path.
    const scrollByPathRef = useRef<Map<string, number>>(new Map());

    // Reset view & summary when switching files.
    // Restores the last view the user was in for this file (unless it was 'conflicts').
    // Directories always go straight to summary view.
    useEffect(() => {
      const saved = activeFile?.path ? viewByPathRef.current.get(activeFile.path) : undefined;
      setIsFolded(false);
      const view: EditorView = (() => {
        if (activeFile?.isDirectory) return 'summary';
        if (!saved || saved === 'conflicts') return 'source';
        if (saved === 'preview' && !isPreviewable(activeFile?.path ?? '')) return 'source';
        return saved;
      })();
      setEditorView(view);
      // Restore the saved scroll position for this file (0 if first visit).
      scrollPercentageRef.current = activeFile?.path
        ? (scrollByPathRef.current.get(activeFile.path) ?? 0)
        : 0;
      previousViewRef.current = view;
      // Preview and summary have no onMount hook like Monaco's onEditorMount, so
      // restoreScrollPercentage must be called here. The double-rAF inside it waits
      // for React to render the new file content before applying scrollTop.
      // Source view is handled by onEditorMount — no call needed here.
      if (view === 'preview' || view === 'summary') {
        restoreScrollPercentage(view);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeFile?.path]);

    // Persist the current view per file so navigating back restores it.
    useEffect(() => {
      if (activeFile?.path) viewByPathRef.current.set(activeFile.path, editorView);
    }, [editorView, activeFile?.path]);

    const {
      summaryContent,
      summaryLoading,
      summaryError,
      hasCachedSummary,
      cachedSummaryObsolete,
      summaryObsolete,
      handleSwitchToSummary,
      handleRegenerateSummary,
    } = useSummary({
      activeFile,
      workspacePath,
      provider,
      model,
      editorView,
      setEditorView,
      summaryRequestPath,
      onSummaryHandled,
      onSummaryOpen,
      onSummaryContentChange,
    });

    // Honor an external request to show the preview for the active file (e.g. markdown wiki navigation).
    // Runs after the file-switch reset effect so it reliably overrides 'source'.
    useEffect(() => {
      if (!previewRequestPath || !activeFile) return;
      if (activeFile.path !== previewRequestPath) return;
      if (isPreviewable(activeFile.path)) setEditorView('preview');
      onPreviewHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [previewRequestPath, activeFile?.path]);

    /** Apply a stored navigation request to the given Monaco editor instance. */
    const applyNavigation = useCallback((editor: MonacoEditorAPI.IStandaloneCodeEditor, line: number, endLine: number, startCol?: number, endCol?: number) => {
      const model = editor.getModel();
      if (!model) return;
      editor.revealLineInCenter(line);
      const hasColRange = startCol != null && endCol != null;
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, [{
        range: {
          startLineNumber: line,
          startColumn: hasColRange ? startCol : 1,
          endLineNumber: endLine,
          endColumn: hasColRange ? endCol : model.getLineMaxColumn(endLine),
        },
        options: {
          isWholeLine: !hasColRange,
          className: 'tutor-line-highlight',
          linesDecorationsClassName: 'tutor-line-gutter',
        },
      }]);
    }, []);

    /** Capture the current scroll position as a 0–1 ratio before switching views,
     *  and persist it to scrollByPathRef so navigation back restores the same spot. */
    const captureScrollPercentage = useCallback(() => {
      const editor = monacoEditorRef.current;
      if (editor && editorView === 'source') {
        const scrollable = editor.getScrollHeight() - editor.getLayoutInfo().height;
        const pct = scrollable > 0 ? editor.getScrollTop() / scrollable : 0;
        scrollPercentageRef.current = pct;
        if (activeFile?.path) scrollByPathRef.current.set(activeFile.path, pct);
        return;
      }
      const el = previewRef.current;
      if (el && editorView === 'preview') {
        const scrollable = el.scrollHeight - el.clientHeight;
        const pct = scrollable > 0 ? el.scrollTop / scrollable : 0;
        scrollPercentageRef.current = pct;
        if (activeFile?.path) scrollByPathRef.current.set(activeFile.path, pct);
      }
    }, [editorView, activeFile?.path]);

    /** Walk heading elements in the container and report which one is at the top of the viewport.
     *  Deduplicates ids the same way parseHeadings does (append -N for Nth duplicate). */
    const trackActiveHeading = useCallback((container: HTMLDivElement) => {
      if (!onActiveHeadingChange) return;
      if (Date.now() < suppressTrackingUntilRef.current) return;
      const containerTop = container.getBoundingClientRect().top;
      const threshold = containerTop + 60;
      const headings = container.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]');
      let activeId: string | null = null;
      const seen = new Map<string, number>();
      for (const h of headings) {
        const base = h.id;
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const uniqueId = n === 0 ? base : `${base}-${n}`;
        if (h.getBoundingClientRect().top <= threshold) activeId = uniqueId;
        else break;
      }
      onActiveHeadingChange(activeId);
    }, [onActiveHeadingChange]);

    /** Restore the captured scroll position in the newly visible view. */
    const restoreScrollPercentage = useCallback((view: EditorView) => {
      const percentage = scrollPercentageRef.current;
      const restore = () => {
        if (view === 'source') {
          const editor = monacoEditorRef.current;
          if (!editor) return false;
          const scrollable = editor.getScrollHeight() - editor.getLayoutInfo().height;
          editor.setScrollTop(Math.max(0, scrollable * percentage));
          return true;
        }
        if (view === 'preview') {
          const el = previewRef.current;
          if (!el) return false;
          const scrollable = el.scrollHeight - el.clientHeight;
          el.scrollTop = Math.max(0, scrollable * percentage);
          return true;
        }
        if (view === 'summary') {
          const el = summaryRef.current;
          if (!el) return false;
          const scrollable = el.scrollHeight - el.clientHeight;
          el.scrollTop = Math.max(0, scrollable * percentage);
          return true;
        }
        return true;
      };
      // Two frames: first lets React render the new view, second waits for layout.
      requestAnimationFrame(() => { restore(); requestAnimationFrame(restore); });
    }, []);

    // Restore scroll whenever the view changes (source ↔ preview).
    useEffect(() => {
      const previous = previousViewRef.current;
      if (editorView !== previous) {
        previousViewRef.current = editorView;
        restoreScrollPercentage(editorView);
      }
    }, [editorView, restoreScrollPercentage]);

    // Notify parent when the editor view changes.
    useEffect(() => {
      onEditorViewChange?.(editorView);
    }, [editorView, onEditorViewChange]);

    useImperativeHandle(ref, () => ({
      save: () => {},
      navigateToLine: (filePath: string, line: number, endLine?: number, startCol?: number, endCol?: number) => {
        const resolvedEndLine = endLine ?? line;
        pendingNavigationRef.current = { filePath, line, endLine: resolvedEndLine, startCol, endCol };
        // If the target file is already active and Monaco is mounted, apply immediately
        if (monacoEditorRef.current && activeFilePath === filePath) {
          applyNavigation(monacoEditorRef.current, line, resolvedEndLine, startCol, endCol);
          pendingNavigationRef.current = null;
        }
      },
      scrollToHeading: (id: string) => {
        const container = editorView === 'summary' ? summaryRef.current : previewRef.current;
        if (!container) return;
        suppressTrackingUntilRef.current = Date.now() + 1200;
        // Walk headings with the same dedup logic as parseHeadings to find the right element.
        const headings = container.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]');
        const seen = new Map<string, number>();
        let target: HTMLElement | null = null;
        for (const h of headings) {
          const base = h.id;
          const n = seen.get(base) ?? 0;
          seen.set(base, n + 1);
          const uniqueId = n === 0 ? base : `${base}-${n}`;
          if (uniqueId === id) { target = h; break; }
        }
        if (!target) return;
        const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
        container.scrollTo({ top: offset - 16, behavior: 'smooth' });
      },
      getVisibleContext: () => {
        const fileName = activeFile?.name ?? '';

        // When the user is viewing the generated summary, send that content
        // rather than the source hidden behind the summary view.
        if (editorView === 'summary') {
          if (!summaryContent.trim()) return null;
          return `File: ${fileName} (generated summary)\n${summaryContent}`;
        }

        const editor = monacoEditorRef.current;
        if (!editor) return null;
        const model = editor.getModel();
        if (!model) return null;

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
    }), [applyNavigation, activeFilePath, activeFile, editorView, summaryContent]);

    const showPreviewButton = !!activeFile && !activeFile.isImage && !activeFile.isPdf && !activeFile.isDirectory && !activeFile.isUrl && isPreviewable(activeFile.path);
    const showSummaryButton = !!activeFile && !activeFile.isImage && !activeFile.isPdf && !activeFile.isDirectory && !activeFile.isUrl && (!!workspacePath || !!activeFile.isExternal) && !activeFile.path.endsWith('.md');
    const showConflictsButton = !!activeFile && !activeFile.isImage && !activeFile.isPdf && !activeFile.isUrl && !activeFile.isDirectory && !activeFile.isExternal && hasConflictMarkers(activeFile.content ?? '');
    const showFoldButton = !!activeFile && !activeFile.isImage && !activeFile.isPdf && !activeFile.isUrl && !activeFile.isDirectory && editorView === 'source' && !activeCommitHash;

    /** Convert an absolute file path to a workspace-relative path. */
    const toRelPath = (abs: string) => {
      if (!workspacePath) return abs;
      for (const sep of ['/', '\\']) {
        if (abs.startsWith(workspacePath + sep)) return abs.slice(workspacePath.length + 1);
      }
      return abs;
    };

    /**
     * Wiki-style navigation: open absPath as a tab, then — if in preview/summary context —
     * prefer showing a cached AI summary, fall back to preview for .md files.
     */
    const wikiNavigate = useCallback(async (absPath: string) => {
      const existing = openFiles.find(f => f.path === absPath);
      if (existing) onTabClick(existing.path);
      else onOpenFile?.(absPath);

      // Check server cache for an AI summary
      const relPath = workspacePath && absPath.startsWith(workspacePath + '/')
        ? absPath.slice(workspacePath.length + 1)
        : absPath;
      try {
        const resp = await fetch(`${API_BASE}/api/ai-summary?path=${encodeURIComponent(relPath)}`);
        const data = await resp.json() as { content: string | null };
        if (data.content) {
          onSummaryRequest?.(absPath);
          return;
        }
      } catch { /* fall through */ }
      // No cached summary — preview markdown files
      if (/\.(md|markdown)$/i.test(absPath)) onPreviewRequest?.(absPath);
    }, [openFiles, onTabClick, onOpenFile, workspacePath, onSummaryRequest, onPreviewRequest]);

    /**
     * Inline-code component for markdown rendering. Text that looks like a relative
     * file path becomes a link opening via wikiNavigate. Block code (className="language-xxx")
     * passes through unchanged.
     */
    const inlineCodeComponent = useCallback(
      ({ children, className, ...props }: React.ComponentPropsWithoutRef<'code'>) => {
        const text = String(children);
        if (!className && activeFile && looksLikePath(text)) {
          const absPath = resolveWorkspacePath(text, activeFile.path);
          return <FilePathLink {...props} path={text} onOpen={() => wikiNavigate(absPath)}>{children}</FilePathLink>;
        }
        return <code {...props} className={className}>{children}</code>;
      },
      [activeFile, wikiNavigate],
    );

    const handleMarkdownLinkClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, target: string) => {
      const isHash = target.startsWith('#');
      const isExternal = /^(https?:|mailto:)/i.test(target);
      if (isExternal) {
        event.preventDefault();
        window.open(target, '_blank', 'noopener,noreferrer');
        return;
      }
      if (isHash || !activeFile?.path) return;
      event.preventDefault();
      const [pathPart, hash] = target.split('#', 2);
      const absPath = resolveWorkspacePath(pathPart, activeFile.path);
      if (editorView === 'preview' || editorView === 'summary') {
        void wikiNavigate(absPath);
      } else {
        const targetFile = openFiles.find(f => f.path === absPath);
        if (targetFile) onTabClick(targetFile.path);
        else onOpenFile?.(absPath);
      }
      if (hash) {
        window.setTimeout(() => {
          const heading = document.getElementById(hash);
          heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
      }
    }, [activeFile?.path, editorView, openFiles, onTabClick, onOpenFile, wikiNavigate]);

    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--color-bg-editor)',
          minWidth: 0,
          position: 'relative',
        }}
      >
        <EditorTabs
          openFiles={openFiles}
          activeFilePath={activeFilePath}
          onTabClick={onTabClick}
          onTabClose={onTabClose}
          onTabReorder={onTabReorder}
        />

        {/* ── Breadcrumb ── */}
        {activeFile && (() => {
          let segments: string[];
          if (activeFile.isUrl) {
            segments = [activeFile.url ?? activeFile.name];
          } else {
            const displayPath = workspacePath && activeFile.path.startsWith(workspacePath + '/')
              ? activeFile.path.slice(workspacePath.length + 1)
              : activeFile.path;
            segments = displayPath.split('/').filter(Boolean);
          }
          return (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              height: 24,
              flexShrink: 0,
              background: 'var(--color-bg-editor)',
              borderBottom: '1px solid var(--color-border)',
            }}>
              {/* Scrollable path segments */}
              <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px 0 12px',
                overflowX: 'auto',
                overflowY: 'hidden',
                scrollbarWidth: 'none',
                whiteSpace: 'nowrap',
                gap: 4,
                fontSize: 12,
                fontFamily: "'Cascadia Code', 'Fira Code', Menlo, monospace",
                minWidth: 0,
              }}>
                {segments.map((seg, i) => {
                  const isLast = i === segments.length - 1;
                  return (
                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      {i > 0 && (
                        <span style={{ color: 'var(--color-text-secondary)', opacity: 0.4, userSelect: 'none' }}>›</span>
                      )}
                      <span style={{
                        color: isLast ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                        fontWeight: isLast ? 500 : 400,
                      }}>
                        {seg}
                      </span>
                    </span>
                  );
                })}
              </div>
              {/* Back / forward navigation pills */}
              <div style={{ display: 'flex', gap: 3, paddingRight: 8, flexShrink: 0 }}>
                {([
                  { dir: 'back', label: '←', title: 'Go back', enabled: !!canGoBack, handler: onGoBack },
                  { dir: 'fwd',  label: '→', title: 'Go forward', enabled: !!canGoForward, handler: onGoForward },
                ] as const).map(({ dir, label, title, enabled, handler }) => (
                  <button
                    key={dir}
                    disabled={!enabled}
                    onClick={handler}
                    title={title}
                    style={{
                      background: enabled ? 'var(--color-accent, #0e639c)22' : 'none',
                      border: `1px solid ${enabled ? 'var(--color-accent, #0e639c)' : 'var(--color-border)'}`,
                      borderRadius: 10,
                      color: enabled ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                      opacity: enabled ? 1 : 0.28,
                      cursor: enabled ? 'pointer' : 'default',
                      fontSize: 12,
                      fontWeight: enabled ? 700 : 400,
                      padding: '0 9px',
                      height: 17,
                      lineHeight: '15px',
                      userSelect: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>

          {/* ── Fold / unfold toggle (top-left) ── */}
          {showFoldButton && (
            <button
              onClick={() => {
                const editor = monacoEditorRef.current;
                if (!editor) return;
                if (isFolded) {
                  editor.getAction('editor.unfoldAll')?.run();
                  setIsFolded(false);
                } else {
                  editor.getAction('editor.foldAll')?.run();
                  setIsFolded(true);
                }
              }}
              title={isFolded ? 'Unfold all' : 'Fold all'}
              style={{
                position: 'absolute', top: 8, left: 8, zIndex: 10,
                padding: '3px 8px',
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1,
                background: isFolded ? 'var(--editor-btn-active-bg, #007acc)' : 'var(--editor-btn-neutral-bg, #3a3d41)',
                color: isFolded ? 'var(--editor-btn-active-color, #fff)' : 'var(--editor-btn-neutral-color, #fff)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                userSelect: 'none',
                boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
              }}
            >
              {isFolded ? 'v' : '>'}
            </button>
          )}

          {/* ── Floating button group (bottom-right) ── */}
          {!activeCommitHash && (showPreviewButton || showSummaryButton || showConflictsButton) && (
            <div style={{
              position: 'absolute', bottom: 20, right: 20, zIndex: 10,
              display: 'flex', gap: 6,
            }}>
              {/* Merge conflict resolver toggle */}
              {showConflictsButton && (
                <button
                  onClick={() => setEditorView(v => v === 'conflicts' ? 'source' : 'conflicts')}
                  title={editorView === 'conflicts' ? 'Back to source' : 'Resolve merge conflicts'}
                  style={{ ...btnStyle, background: editorView === 'conflicts' ? 'var(--editor-btn-active-bg, #007acc)' : '#6f4e37', color: editorView === 'conflicts' ? 'var(--editor-btn-active-color, #fff)' : '#fff' }}
                >
                  {editorView === 'conflicts' ? 'Source' : 'Conflicts'}
                </button>
              )}

              {/* Preview toggle — only for .md / .html */}
              {showPreviewButton && editorView !== 'summary' && editorView !== 'conflicts' && (
                <button
                  onClick={() => { captureScrollPercentage(); setEditorView(v => v === 'preview' ? 'source' : 'preview'); }}
                  title={editorView === 'preview' ? 'Switch to source' : 'Switch to preview'}
                  style={{
                    ...btnStyle,
                    background: editorView === 'preview' ? 'var(--editor-btn-active-bg, #007acc)' : 'var(--editor-btn-neutral-bg, #3a3d41)',
                    color: editorView === 'preview' ? 'var(--editor-btn-active-color, #fff)' : 'var(--editor-btn-neutral-color, #fff)',
                  }}
                >
                  {editorView === 'preview' ? 'Source' : 'Preview'}
                </button>
              )}

              {/* AI Summary toggle */}
              {showSummaryButton && editorView !== 'conflicts' && (
                <button
                  onClick={() => editorView === 'summary'
                    ? setEditorView('source')
                    : handleSwitchToSummary()}
                  title={editorView === 'summary' ? 'Back to source' : hasCachedSummary ? (cachedSummaryObsolete ? 'Cached summary is outdated — file has changed' : 'View cached summary') : 'Generate AI summary'}
                  style={{
                    ...btnStyle,
                    background: editorView === 'summary'
                      ? 'var(--editor-btn-active-bg, #007acc)'
                      : cachedSummaryObsolete
                        ? 'var(--summary-button-obsolete-bg, #7a5500)'
                        : 'var(--summary-button-bg, #3a3d41)',
                    color: editorView === 'summary'
                      ? 'var(--editor-btn-active-color, #fff)'
                      : cachedSummaryObsolete
                        ? 'var(--summary-button-obsolete-color, #fff)'
                        : 'var(--summary-button-color, #fff)',
                  }}
                >
                  {editorView === 'summary' ? 'Source' : hasCachedSummary ? 'View Summary' : 'Generate Summary'}
                </button>
              )}
            </div>
          )}

          {/* ── Content area ── */}
          {activeFile ? (
            activeFile.isImage ? (
              <ImageViewer path={activeFile.path} name={activeFile.name} />

            ) : activeFile.isPdf ? (
              <PdfViewer path={activeFile.path} name={activeFile.name} />

            ) : activeFile.isUrl ? (
              <iframe
                src={activeFile.url}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title={activeFile.name}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              />

            ) : editorView === 'summary' ? (
              /* AI Summary view */
              <div
                ref={summaryRef}
                onScroll={e => {
                  trackActiveHeading(e.currentTarget);
                  const el = e.currentTarget;
                  const scrollable = el.scrollHeight - el.clientHeight;
                  const pct = scrollable > 0 ? el.scrollTop / scrollable : 0;
                  scrollPercentageRef.current = pct;
                  if (activeFile?.path) scrollByPathRef.current.set(activeFile.path, pct);
                }}
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
                    {activeFile.isDirectory && (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, color: 'var(--color-folder)' }} aria-hidden="true">
                        <path d="M.54 3.87L.5 3a2 2 0 0 1 2-2h3.19a2 2 0 0 1 1.45.63l.41.44H14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V5.07a2.5 2.5 0 0 0 .54-1.2z" />
                      </svg>
                    )}
                    {toRelPath(activeFile.path)}
                    {activeFile.isDirectory && <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'sans-serif', fontStyle: 'italic' }}> — directory summary</span>}
                  </span>
                  {!summaryLoading && (summaryContent || summaryError) && (
                    <button
                      onClick={handleRegenerateSummary}
                      title={summaryObsolete ? 'Summary is outdated — file has changed since it was generated' : 'Regenerate summary'}
                      style={{
                        background: 'none',
                        border: `1px solid ${summaryObsolete ? '#e9b44c' : 'var(--color-border)'}`,
                        borderRadius: 4,
                        color: summaryObsolete ? '#e9b44c' : 'var(--color-text-secondary)',
                        fontSize: 11, padding: '2px 8px', cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      ↺ Regenerate{summaryObsolete ? ' (Obsolete)' : ''}
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
                  <MarkdownRenderer
                    content={summaryContent}
                    activeFilePath={activeFile.path}
                    inlineCodeComponent={inlineCodeComponent}
                    onLinkClick={handleMarkdownLinkClick}
                  />
                )}
              </div>

            ) : editorView === 'preview' && isPreviewable(activeFile.path) ? (
              /* Markdown / HTML preview */
              activeFile.path.endsWith('.md') ? (
                <div
                  ref={previewRef}
                  onScroll={e => { captureScrollPercentage(); trackActiveHeading(e.currentTarget); }}
                  className="md-preview"
                  style={{
                    height: '100%', overflow: 'auto',
                    padding: '24px 32px',
                    color: 'var(--color-text-primary)',
                    fontSize: 14, lineHeight: 1.7,
                    boxSizing: 'border-box',
                  }}
                >
                  <MarkdownRenderer
                    content={activeFile.content ?? ''}
                    activeFilePath={activeFile.path}
                    inlineCodeComponent={inlineCodeComponent}
                    onLinkClick={handleMarkdownLinkClick}
                  />
                </div>
              ) : (
                <iframe
                  srcDoc={activeFile.content}
                  sandbox="allow-scripts"
                  style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                  title="HTML preview"
                />
              )

            ) : editorView === 'conflicts' ? (
              /* Merge conflict resolver */
              <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'var(--color-bg-editor)' }}>
                <MergeConflictView
                  conflictContent={activeFile.content ?? ''}
                  filePath={activeFile.path}
                  language={activeFile.language ?? 'plaintext'}
                  theme={document.documentElement.dataset.theme === 'light' ? 'light' : 'vs-dark'}
                  onSaved={(resolved) => {
                    onContentChange(activeFile.path, resolved);
                    setEditorView('source');
                  }}
                  onClose={() => setEditorView('source')}
                />
              </div>

            ) : activeFile.isDirectory ? null : (
              /* Monaco source editor */
              <MonacoEditor
                key={activeFile.path}
                file={activeFile}
                onContentChange={onContentChange}
                diffData={diffData}
                onActivity={onActivity}
                onEditorMount={editor => {
                  monacoEditorRef.current = editor;
                  // Track Monaco scroll continuously so the position is saved
                  // to scrollByPathRef before this editor instance unmounts.
                  const filePath = activeFile.path;
                  editor.onDidScrollChange(() => {
                    const scrollable = editor.getScrollHeight() - editor.getLayoutInfo().height;
                    const pct = scrollable > 0 ? editor.getScrollTop() / scrollable : 0;
                    scrollPercentageRef.current = pct;
                    scrollByPathRef.current.set(filePath, pct);
                  });
                  // Apply any pending navigation for this file
                  const nav = pendingNavigationRef.current;
                  if (nav && nav.filePath === activeFile.path) {
                    pendingNavigationRef.current = null;
                    applyNavigation(editor, nav.line, nav.endLine, nav.startCol, nav.endCol);
                  }
                  restoreScrollPercentage('source');
                }}
                onAfterRevert={() => {
                  // Monaco's onChange fires synchronously from executeEdits, so
                  // content state updates in the same microtask batch. A short
                  // delay lets React flush before we read contentRef in refreshDiff.
                  setTimeout(refreshDiff, 50);
                }}
              />
            )
          ) : (
            <WelcomeScreen />
          )}

        </div>

        {/* ── Commit diff overlay — covers tabs + breadcrumb + content ── */}
        {activeCommitHash && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'var(--color-bg-editor)' }}>
            <CommitDiffView
              hash={activeCommitHash}
              theme={document.documentElement.dataset.theme === 'light' ? 'light' : 'vs-dark'}
              onClose={() => onCommitDiffClose?.()}
              onCheckout={() => onCommitCheckout?.(activeCommitHash)}
              onAddToContext={onCommitDiffAddToContext}
            />
          </div>
        )}
      </div>
    );
  }
);
