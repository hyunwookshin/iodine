import { useRef, useEffect, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditorAPI } from 'monaco-editor';
import type { Monaco } from '@monaco-editor/react';
import type { OpenFile } from '../../types';
import type { DiffData } from '../../hooks/useFileDiff';

interface MonacoEditorProps {
  file: OpenFile;
  onContentChange: (path: string, content: string) => void;
  diffData?: DiffData | null;
}

export function MonacoEditor({ file, onContentChange, diffData }: MonacoEditorProps) {
  const editorRef = useRef<MonacoEditorAPI.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const viewZoneIdsRef = useRef<Map<number, string>>(new Map());
  const diffDataRef = useRef<DiffData | null>(diffData ?? null);
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Keep diffDataRef in sync so the click handler always has the latest data
  useEffect(() => { diffDataRef.current = diffData ?? null; }, [diffData]);

  // Reset expanded blocks when the file changes
  useEffect(() => { setExpanded(new Set()); }, [file.path]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.onMouseDown(e => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const lineNumber = e.target.position?.lineNumber;
      if (lineNumber == null || !diffDataRef.current) return;

      const block = diffDataRef.current.deleted.find(d => {
        const markerLine = d.afterLine === 0 ? 1 : d.afterLine;
        return markerLine === lineNumber;
      });

      if (block) {
        setExpanded(prev => {
          const next = new Set(prev);
          next.has(block.afterLine) ? next.delete(block.afterLine) : next.add(block.afterLine);
          return next;
        });
      }
    });

    setMounted(true);
  };

  // Apply/update decorations and view zones whenever diff data or expanded state changes
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !mounted) return;

    // Clear existing decorations
    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);

    // Clear existing view zones
    editor.changeViewZones(accessor => {
      viewZoneIdsRef.current.forEach(id => accessor.removeZone(id));
      viewZoneIdsRef.current.clear();
    });

    if (!diffData) return;

    const newDecorations: MonacoEditorAPI.IModelDeltaDecoration[] = [];

    for (const line of diffData.added) {
      newDecorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'git-added-line',
          glyphMarginClassName: 'git-added-glyph',
          overviewRuler: { color: '#2ea043', position: monaco.editor.OverviewRulerLane.Left },
        },
      });
    }

    for (const line of diffData.modified) {
      newDecorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'git-modified-line',
          glyphMarginClassName: 'git-modified-glyph',
          overviewRuler: { color: '#e9b44c', position: monaco.editor.OverviewRulerLane.Left },
        },
      });
    }

    for (const block of diffData.deleted) {
      const markerLine = block.afterLine === 0 ? 1 : block.afterLine;
      const isOpen = expanded.has(block.afterLine);
      newDecorations.push({
        range: new monaco.Range(markerLine, 1, markerLine, 1),
        options: {
          glyphMarginClassName: isOpen ? 'git-deleted-glyph-open' : 'git-deleted-glyph',
          overviewRuler: { color: '#f44747', position: monaco.editor.OverviewRulerLane.Left },
          glyphMarginHoverMessage: { value: isOpen ? 'Click to collapse deleted lines' : 'Click to show deleted lines' },
        },
      });
    }

    decorationIdsRef.current = editor.deltaDecorations([], newDecorations);

    // Add view zones for expanded deleted blocks
    editor.changeViewZones(accessor => {
      for (const block of diffData.deleted) {
        if (!expanded.has(block.afterLine)) continue;

        const domNode = document.createElement('div');
        Object.assign(domNode.style, {
          fontFamily: "'Cascadia Code', 'Fira Code', Menlo, monospace",
          fontSize: '13px',
          lineHeight: '19px',
          background: 'rgba(244, 71, 71, 0.12)',
          borderLeft: '3px solid #f44747',
          color: '#f08080',
          whiteSpace: 'pre',
          paddingLeft: '60px',
          boxSizing: 'border-box',
          overflow: 'hidden',
          width: '100%',
        });
        domNode.textContent = block.lines.join('\n');

        const id = accessor.addZone({
          afterLineNumber: block.afterLine,
          heightInLines: block.lines.length,
          domNode,
        });
        viewZoneIdsRef.current.set(block.afterLine, id);
      }
    });
  }, [diffData, expanded, mounted]);

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={file.language}
      value={file.content}
      onChange={value => onContentChange(file.path, value ?? '')}
      onMount={handleMount}
      options={{
        fontSize: 14,
        fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, 'Courier New', monospace",
        fontLigatures: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        renderWhitespace: 'selection',
        tabSize: 2,
        automaticLayout: true,
        smoothScrolling: true,
        cursorSmoothCaretAnimation: 'on',
        lineNumbers: 'on',
        glyphMargin: true,
        folding: true,
        renderLineHighlight: 'line',
        bracketPairColorization: { enabled: true },
        padding: { top: 8 },
      }}
    />
  );
}
