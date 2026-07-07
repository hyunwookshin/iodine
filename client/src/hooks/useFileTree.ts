import { useState, useEffect, useCallback } from 'react';
import { fetchFileTree } from '../api/files';
import type { FileNode } from '../types';

export function useFileTree(workspacePath: string | null) {
  const [tree, setTree] = useState<FileNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTree = useCallback(async (wsPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFileTree();
      setTree(result);
      // Auto-expand root and its direct children
      const expanded = new Set<string>();
      expanded.add(wsPath);
      if (result.children) {
        result.children
          .filter(n => n.type === 'directory')
          .slice(0, 5)
          .forEach(n => expanded.add(n.path));
      }
      setExpandedPaths(expanded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file tree');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!workspacePath) {
      setTree(null);
      setExpandedPaths(new Set());
      return;
    }
    loadTree(workspacePath);
  }, [workspacePath, loadTree]);

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
    if (workspacePath) loadTree(workspacePath);
  }, [workspacePath, loadTree]);

  return { tree, expandedPaths, toggleExpand, loading, error, refetch };
}
