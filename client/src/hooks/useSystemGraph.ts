import { useState, useEffect, useCallback } from 'react';
import { fetchSystemGraph, putSystemGraph } from '../api/files';
import type { SystemGraph } from '../api/files';

const EMPTY: SystemGraph = { nodes: [], edges: [] };

export function useSystemGraph(workspacePath: string | null) {
  const [graph, setGraph] = useState<SystemGraph>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspacePath) { setGraph(EMPTY); setLoaded(true); return; }
    try {
      const g = await fetchSystemGraph();
      setGraph(g ?? EMPTY);
    } catch {
      setGraph(EMPTY);
    } finally {
      setLoaded(true);
    }
  }, [workspacePath]);

  useEffect(() => { setLoaded(false); load(); }, [load]);

  const save = useCallback(async (g: SystemGraph) => {
    if (!workspacePath) return;
    setSaving(true);
    setSaveError(null);
    try {
      await putSystemGraph(g);
      setGraph(g);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [workspacePath]);

  return { graph, loaded, saving, saveError, save };
}
