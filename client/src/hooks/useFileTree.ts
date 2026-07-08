import { useState, useEffect, useCallback } from 'react';
import { fetchFileTree } from '../api/files';
import type { FileNode } from '../types';

export function useFileTree(workspacePath: string | null, localTree?: FileNode | null) {
  const [serverTree, setServerTree] = useState<FileNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const autoExpand = useCallback((root: FileNode) => {
    const expanded = new Set<string>();
    expanded.add(root.path);
    if (root.children) {
      root.children
        .filter(n => n.type === 'directory')
        .slice(0, 5)
        .forEach(n => expanded.add(n.path));
    }
    setExpandedPaths(expanded);
  }, []);

  const loadTree = useCallback(async (_wsPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFileTree();
      setServerTree(result);
      autoExpand(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file tree');
    } finally {
      setLoading(false);
    }
  }, [autoExpand]);

  // Server mode: fetch when workspacePath changes (skip if a local tree is active)
  useEffect(() => {
    if (localTree) return;
    if (!workspacePath) {
      setServerTree(null);
      setExpandedPaths(new Set());
      return;
    }
    loadTree(workspacePath);
  }, [workspacePath, localTree, loadTree]);

  // Local mode: auto-expand when local tree changes
  useEffect(() => {
    if (localTree) autoExpand(localTree);
  }, [localTree, autoExpand]);

  const tree = localTree ?? serverTree;

  const toggleExpand = useCallback((nodePath: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(nodePath)) {
        next.delete(nodePath);
      } else {
        next.add(nodePath);
      }
      return next;
    });
  }, []);

  const refetch = useCallback(() => {
    if (localTree) return; // no-op in local mode
    if (workspacePath) loadTree(workspacePath);
  }, [workspacePath, localTree, loadTree]);

  return { tree, expandedPaths, toggleExpand, loading, error, refetch };
}
