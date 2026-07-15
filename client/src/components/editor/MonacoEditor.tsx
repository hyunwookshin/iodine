import { useRef, useEffect, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditorAPI } from 'monaco-editor';
import type { Monaco } from '@monaco-editor/react';
import type { OpenFile } from '../../types';
import type { DiffData } from '../../hooks/useFileDiff';
import type { ModifiedLine } from '../../api/files';

interface MonacoEditorProps {
  file: OpenFile;
  onContentChange: (path: string, content: string) => void;
  diffData?: DiffData | null;
}

// ── Hunk grouping helpers ─────────────────────────────────────────────────────

function groupContiguous(lines: number[]): Array<[number, number]> {
  const sorted = [...lines].sort((a, b) => a - b);
  const groups: Array<[number, number]> = [];
  for (const n of sorted) {
    if (groups.length > 0 && n === groups[groups.length - 1][1] + 1) {
      groups[groups.length - 1][1] = n;
    } else {
      groups.push([n, n]);
    }
  }
  return groups;
}

type ModifiedGroup = { start: number; end: number; originals: string[] };

function groupModified(lines: ModifiedLine[]): ModifiedGroup[] {
  const sorted = [...lines].sort((a, b) => a.line - b.line);
  const groups: ModifiedGroup[] = [];
  for (const ml of sorted) {
    const last = groups[groups.length - 1];
    if (last && ml.line === last.end + 1) {
      last.end = ml.line;
      last.originals.push(ml.originalLine);
    } else {
      groups.push({ start: ml.line, end: ml.line, originals: [ml.originalLine] });
    }
  }
  return groups;
}

// ── Revert helpers (use executeEdits to preserve undo history) ────────────────

function revertAdded(
  editor: MonacoEditorAPI.IStandaloneCodeEditor,
  startLine: number,
  endLine: number,
): void {
  const model = editor.getModel();
  if (!model) return;
  const lineCount = model.getLineCount();
  let range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  if (endLine < lineCount) {
    range = { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine + 1, endColumn: 1 };
  } else if (startLine > 1) {
    range = {
      startLineNumber: startLine - 1,
      startColumn: model.getLineMaxColumn(startLine - 1),
      endLineNumber: endLine,
      endColumn: model.getLineMaxColumn(endLine),
    };
  } else {
    range = { startLineNumber: 1, startColumn: 1, endLineNumber: endLine, endColumn: model.getLineMaxColumn(endLine) };
  }
  editor.executeEdits('revert-hunk', [{ range, text: '' }]);
}

function revertModified(
  editor: MonacoEditorAPI.IStandaloneCodeEditor,
  startLine: number,
  endLine: number,
  originalLines: string[],
): void {
  const model = editor.getModel();
  if (!model) return;
  editor.executeEdits('revert-hunk', [{
    range: { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: model.getLineMaxColumn(endLine) },
    text: originalLines.join('\n'),
  }]);
}

function revertDeleted(
  editor: MonacoEditorAPI.IStandaloneCodeEditor,
  afterLine: number,
  lines: string[],
): void {
  const model = editor.getModel();
  if (!model) return;
  if (afterLine === 0) {
    editor.executeEdits('revert-hunk', [{
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
      text: lines.join('\n') + '\n',
    }]);
  } else {
    const col = model.getLineMaxColumn(afterLine);
    editor.executeEdits('revert-hunk', [{
      range: { startLineNumber: afterLine, startColumn: col, endLineNumber: afterLine, endColumn: col },
      text: '\n' + lines.join('\n'),
    }]);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

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

      const data = diffDataRef.current;

      // Deleted block → expand/collapse view zone
      const deletedBlock = data.deleted.find(d => {
        const markerLine = d.afterLine === 0 ? 1 : d.afterLine;
        return markerLine === lineNumber;
      });
      if (deletedBlock) {
        setExpanded(prev => {
          const next = new Set(prev);
          next.has(deletedBlock.afterLine) ? next.delete(deletedBlock.afterLine) : next.add(deletedBlock.afterLine);
          return next;
        });
        return;
      }

      // Added lines → revert (delete them)
      const addedGroup = groupContiguous(data.added).find(([s, e]) => lineNumber >= s && lineNumber <= e);
      if (addedGroup) {
        revertAdded(editor, addedGroup[0], addedGroup[1]);
        return;
      }

      // Modified lines → revert (restore original)
      const modifiedGroup = groupModified(data.modified).find(g => lineNumber >= g.start && lineNumber <= g.end);
      if (modifiedGroup) {
        revertModified(editor, modifiedGroup.start, modifiedGroup.end, modifiedGroup.originals);
        return;
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
          glyphMarginHoverMessage: { value: 'Click to revert this change' },
          overviewRuler: { color: '#2ea043', position: monaco.editor.OverviewRulerLane.Left },
        },
      });
    }

    for (const ml of diffData.modified) {
      newDecorations.push({
        range: new monaco.Range(ml.line, 1, ml.line, 1),
        options: {
          isWholeLine: true,
          className: 'git-modified-line',
          glyphMarginClassName: 'git-modified-glyph',
          glyphMarginHoverMessage: { value: 'Click to revert this change' },
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
          background: 'rgba(244, 71, 71, 0.12)',
          borderLeft: '3px solid #f44747',
          boxSizing: 'border-box',
          overflow: 'hidden',
          width: '100%',
          position: 'relative',
        });

        const linesDiv = document.createElement('div');
        Object.assign(linesDiv.style, {
          fontFamily: "'Cascadia Code', 'Fira Code', Menlo, monospace",
          fontSize: '13px',
          lineHeight: '19px',
          color: '#f08080',
          whiteSpace: 'pre',
          paddingLeft: '60px',
          paddingRight: '80px',
        });
        linesDiv.textContent = block.lines.join('\n');

        const revertBtn = document.createElement('button');
        revertBtn.textContent = '↺ Revert';
        Object.assign(revertBtn.style, {
          position: 'absolute',
          top: '2px',
          right: '8px',
          fontSize: '11px',
          color: '#f08080',
          background: 'rgba(244, 71, 71, 0.15)',
          border: '1px solid rgba(244, 71, 71, 0.4)',
          borderRadius: '3px',
          padding: '1px 6px',
          cursor: 'pointer',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          lineHeight: '1.4',
        });
        revertBtn.addEventListener('click', e => {
          e.stopPropagation();
          const ed = editorRef.current;
          if (!ed) return;
          revertDeleted(ed, block.afterLine, block.lines);
          setExpanded(prev => {
            const next = new Set(prev);
            next.delete(block.afterLine);
            return next;
          });
        });

        domNode.appendChild(linesDiv);
        domNode.appendChild(revertBtn);

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
      theme={document.documentElement.dataset.theme === 'light' ? 'light' : 'vs-dark'}
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
