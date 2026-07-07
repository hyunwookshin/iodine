import { forwardRef, useImperativeHandle } from 'react';
import { EditorTabs } from '../editor/EditorTabs';
import { MonacoEditor } from '../editor/MonacoEditor';
import { WelcomeScreen } from '../editor/WelcomeScreen';
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

export const EditorArea = forwardRef<EditorAreaHandle, EditorAreaProps>(
  function EditorArea({ openFiles, activeFilePath, onTabClick, onTabClose, onContentChange }, ref) {
    const activeFile = openFiles.find(f => f.path === activeFilePath) ?? null;

    useImperativeHandle(ref, () => ({
      save: () => {
        // Save is handled by WorkbenchLayout via saveFile hook
      },
    }));

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
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activeFile ? (
            <MonacoEditor
              key={activeFile.path}
              file={activeFile}
              onContentChange={onContentChange}
            />
          ) : (
            <WelcomeScreen />
          )}
        </div>
      </div>
    );
  }
);
