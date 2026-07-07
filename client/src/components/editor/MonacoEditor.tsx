import Editor from '@monaco-editor/react';
import type { OpenFile } from '../../types';

interface MonacoEditorProps {
  file: OpenFile;
  onContentChange: (path: string, content: string) => void;
}

export function MonacoEditor({ file, onContentChange }: MonacoEditorProps) {
  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={file.language}
      value={file.content}
      onChange={value => onContentChange(file.path, value ?? '')}
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
