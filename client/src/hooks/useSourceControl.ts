import { useState, useEffect, useCallback } from 'react';
import {
  fetchGitChanges,
  stageFile, unstageFile, stageAll, discardFile, commitChanges,
} from '../api/files';
import type { GitChange } from '../api/files';

export type { GitChange };

export function useSourceControl(workspacePath: string | null) {
  const [branch, setBranch] = useState('');
  const [staged, setStaged] = useState<GitChange[]>([]);
  const [unstaged, setUnstaged] = useState<GitChange[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setBranch(''); setStaged([]); setUnstaged([]); setLoaded(false);
      return;
    }
    try {
      const data = await fetchGitChanges();
      setBranch(data.branch);
      setStaged(data.staged);
      setUnstaged(data.unstaged);
    } catch {
      setBranch(''); setStaged([]); setUnstaged([]);
    } finally {
      setLoaded(true);
    }
  }, [workspacePath]);

  useEffect(() => {
    setLoaded(false);
    refresh();
    const interval = setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [refresh]);

  const stage = async (relPath: string) => {
    try { await stageFile(relPath); } catch { /* ignore */ }
    await refresh();
  };

  const unstage = async (relPath: string) => {
    try { await unstageFile(relPath); } catch { /* ignore */ }
    await refresh();
  };

  const stageAllChanges = async () => {
    try { await stageAll(); } catch { /* ignore */ }
    await refresh();
  };

  const discard = async (relPath: string, isUntracked: boolean) => {
    try { await discardFile(relPath, isUntracked); } catch { /* ignore */ }
    await refresh();
  };

  const commit = async () => {
    if (!commitMessage.trim() || staged.length === 0 || loading) return;
    setLoading(true);
    try {
      await commitChanges(commitMessage);
      setCommitMessage('');
    } catch { /* ignore */ }
    setLoading(false);
    await refresh();
  };

  return {
    branch, staged, unstaged, loaded, loading,
    commitMessage, setCommitMessage,
    stage, unstage, stageAllChanges, discard, commit,
  };
}
