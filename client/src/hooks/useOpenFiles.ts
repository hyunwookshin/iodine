import { useState, useCallback, useRef } from 'react';
import { fetchFileContent, putFileContent } from '../api/files';
import type { FileNode, OpenFile } from '../types';

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  html: 'html', htm: 'html',
  md: 'markdown', mdx: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  sql: 'sql',
  graphql: 'graphql', gql: 'graphql',
  dockerfile: 'dockerfile',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);

function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile') return 'dockerfile';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext';
}

function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext);
}

export function useOpenFiles() {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  // Track in-flight opens to prevent duplicate fetches
  const openingPaths = useRef<Set<string>>(new Set());
  // Holds local File objects when a project was opened via the directory picker.
  // Using a ref avoids recreating openFile/saveFile callbacks when the map changes.
  const localFileMapRef = useRef<Map<string, File> | null>(null);
  // Mirror of openFiles for stable callbacks that don't need it as a dependency
  const openFilesRef = useRef<OpenFile[]>([]);
  openFilesRef.current = openFiles;

  /** Called from WorkbenchLayout when the user opens a local project via the menu bar. */
  const setLocalFileMap = useCallback((map: Map<string, File> | null) => {
    localFileMapRef.current = map;
  }, []);

  const openFile = useCallback(async (node: FileNode) => {
    if (node.type === 'directory') return;

    // If already open, just activate it
    setOpenFiles(prev => {
      if (prev.some(f => f.path === node.path)) {
        setActiveFilePath(node.path);
        return prev;
      }
      return prev;
    });

    // Check current state synchronously via ref pattern
    if (openingPaths.current.has(node.path)) return;
    openingPaths.current.add(node.path);

    try {
      // Image files are rendered directly via URL — no text content needed
      if (isImageFile(node.name)) {
        const newFile: OpenFile = {
          path: node.path,
          name: node.name,
          content: '',
          savedContent: '',
          isDirty: false,
          language: 'plaintext',
          isImage: true,
        };
        setOpenFiles(prev => {
          if (prev.some(f => f.path === node.path)) return prev;
          return [...prev, newFile];
        });
        setActiveFilePath(node.path);
        return;
      }

      let content: string;
      const localFile = localFileMapRef.current?.get(node.path);
      if (localFile) {
        // Local project opened via browser directory picker — read from File object
        content = await localFile.text();
      } else {
        // Server-backed workspace — read from Express API
        content = await fetchFileContent(node.path);
      }

      const newFile: OpenFile = {
        path: node.path,
        name: node.name,
        content,
        savedContent: content,
        isDirty: false,
        language: detectLanguage(node.name),
      };
      setOpenFiles(prev => {
        if (prev.some(f => f.path === node.path)) return prev;
        return [...prev, newFile];
      });
      setActiveFilePath(node.path);
    } catch (err) {
      console.error('Failed to open file:', err);
    } finally {
      openingPaths.current.delete(node.path);
    }
  }, []); // stable — localFileMapRef is accessed via ref, not closure

  const updateContent = useCallback((filePath: string, newContent: string) => {
    setOpenFiles(prev =>
      prev.map(f =>
        f.path === filePath
          ? { ...f, content: newContent, isDirty: newContent !== f.savedContent }
          : f
      )
    );
  }, []);

  const saveFile = useCallback(async (filePath: string | null) => {
    if (!filePath) return;
    setOpenFiles(prev => {
      const file = prev.find(f => f.path === filePath);
      if (!file || !file.isDirty) return prev;

      if (localFileMapRef.current?.has(filePath)) {
        // Local project opened via browser picker — no write-back (File API is read-only
        // for <input webkitdirectory>). Mark saved in-memory so the dirty indicator clears.
        return prev.map(f =>
          f.path === filePath ? { ...f, savedContent: f.content, isDirty: false } : f
        );
      }

      putFileContent(filePath, file.content)
        .then(() => {
          setOpenFiles(current =>
            current.map(f =>
              f.path === filePath ? { ...f, savedContent: f.content, isDirty: false } : f
            )
          );
        })
        .catch(err => console.error('Save failed:', err));

      return prev;
    });
  }, []);

  /** Re-fetches a file from disk if it's open and not dirty (called by file watcher). */
  const refreshFile = useCallback((absPath: string) => {
    const file = openFilesRef.current.find(f => f.path === absPath);
    if (!file || file.isDirty || file.isImage || localFileMapRef.current?.has(absPath)) return;
    fetchFileContent(absPath)
      .then(content => {
        setOpenFiles(prev =>
          prev.map(f =>
            f.path === absPath && !f.isDirty
              ? { ...f, content, savedContent: content }
              : f
          )
        );
      })
      .catch(() => { /* file deleted or unreadable — leave editor as-is */ });
  }, []); // stable: reads state via ref, writes via functional setState

  const closeFile = useCallback((filePath: string) => {
    setOpenFiles(prev => {
      const idx = prev.findIndex(f => f.path === filePath);
      const next = prev.filter(f => f.path !== filePath);

      setActiveFilePath(current => {
        if (current !== filePath) return current;
        if (next.length === 0) return null;
        return next[Math.max(0, idx - 1)]?.path ?? next[0].path;
      });

      return next;
    });
  }, []);

  const activeFile = openFiles.find(f => f.path === activeFilePath) ?? null;

  return {
    openFiles,
    activeFile,
    activeFilePath,
    setActiveFilePath,
    openFile,
    updateContent,
    saveFile,
    closeFile,
    refreshFile,
    setLocalFileMap,
  };
}
