import { useState, useEffect, useCallback } from 'react';
import {
  fetchGitChanges, fetchGitLog, fetchGitBranches,
  stageFile, unstageFile, stageAll, discardFile, commitChanges,
  checkoutBranch, stashChanges, pushBranch,
} from '../api/files';
import type { GitChange, GitCommit, GitBranchInfo, GitBranches } from '../api/files';

export type { GitChange, GitCommit, GitBranchInfo };

export type ConfirmDialog = {
  type: 'stash' | 'detached-commit' | null;
  label: string;
  message: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
};

export function useSourceControl(workspacePath: string | null) {
  const [branch, setBranch] = useState('');
  const [staged, setStaged] = useState<GitChange[]>([]);
  const [unstaged, setUnstaged] = useState<GitChange[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [localBranches, setLocalBranches] = useState<GitBranchInfo[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<GitBranches['remote']>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [pushStatus, setPushStatus] = useState<null | 'pushing' | 'success' | 'error'>(null);
  const [pushError, setPushError] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>({ type: null, label: '', message: '', onConfirm: async () => {}, onCancel: () => {} });

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setBranch(''); setStaged([]); setUnstaged([]);
      setCommits([]); setLocalBranches([]); setRemoteBranches([]);
      setLoaded(false);
      return;
    }
    try {
      const [changesData, logData, branchesData] = await Promise.all([
        fetchGitChanges(),
        fetchGitLog(),
        fetchGitBranches(),
      ]);
      setBranch(changesData.branch);
      setStaged(changesData.staged);
      setUnstaged(changesData.unstaged);
      setCommits(logData);
      setLocalBranches(branchesData.local);
      setRemoteBranches(branchesData.remote);
    } catch {
      setBranch(''); setStaged([]); setUnstaged([]);
      setCommits([]); setLocalBranches([]); setRemoteBranches([]);
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

  // Shared stash-or-abort guard used before any checkout
  const guardChanges = async (label: string): Promise<boolean> => {
    const hasChanges = staged.length > 0 || unstaged.length > 0;
    if (!hasChanges) return true;

    return new Promise((resolve) => {
      setConfirmDialog({
        type: 'stash',
        label,
        message: `You have uncommitted changes.\n\nCommit or stash them before switching.\n\nStash and switch to ${label} or abort?`,
        onConfirm: async () => {
          try {
            await stashChanges();
            setConfirmDialog({ type: null, label: '', message: '', onConfirm: async () => {}, onCancel: () => {} });
            resolve(true);
          } catch (err: unknown) {
            window.alert(`Failed to stash changes:\n${(err as Error).message}`);
            setConfirmDialog({ type: null, label: '', message: '', onConfirm: async () => {}, onCancel: () => {} });
            resolve(false);
          }
        },
        onCancel: () => {
          setConfirmDialog({ type: null, label: '', message: '', onConfirm: async () => {}, onCancel: () => {} });
          resolve(false);
        },
      });
    });
  };

  // Checkout a branch, stashing uncommitted changes first if needed
  const checkout = async (targetBranch: string) => {
    if (!await guardChanges(`'${targetBranch}'`)) return;
    try {
      await checkoutBranch(targetBranch);
    } catch (err: unknown) {
      window.alert(`Checkout failed:\n${(err as Error).message}`);
      return;
    }
    await refresh();
  };

  // Checkout a specific commit (detached HEAD), stashing changes first if needed
  const checkoutCommit = async (hash: string, shortHash: string) => {
    if (!await guardChanges(`commit ${shortHash}`)) return;

    const confirmed = await new Promise<boolean>((resolve) => {
      setConfirmDialog({
        type: 'detached-commit',
        label: shortHash,
        message: `Checkout commit ${shortHash}?\n\nYou will be in detached HEAD state — commits made here won't belong to any branch unless you create one.`,
        onConfirm: async () => {
          setConfirmDialog({ type: null, label: '', message: '', onConfirm: async () => {}, onCancel: () => {} });
          resolve(true);
        },
        onCancel: () => {
          setConfirmDialog({ type: null, label: '', message: '', onConfirm: async () => {}, onCancel: () => {} });
          resolve(false);
        },
      });
    });

    if (!confirmed) return;

    try {
      await checkoutBranch(hash, true /* detach */);
      await refresh();
    } catch (err: unknown) {
      window.alert(`Checkout failed:\n${(err as Error).message}`);
    }
  };

  const push = async () => {
    if (pushStatus === 'pushing') return;
    setPushStatus('pushing');
    setPushError('');
    try {
      await pushBranch();
      setPushStatus('success');
      await refresh();
      setTimeout(() => setPushStatus(prev => prev === 'success' ? null : prev), 3000);
    } catch (err: unknown) {
      const msg = (err as Error).message;
      setPushStatus('error');
      setPushError(msg);
      setTimeout(() => setPushStatus(prev => prev === 'error' ? null : prev), 6000);
    }
  };

  return {
    branch, staged, unstaged, commits, localBranches, remoteBranches,
    loaded, loading, commitMessage, setCommitMessage,
    pushStatus, pushError,
    confirmDialog,
    stage, unstage, stageAllChanges, discard, commit, checkout, checkoutCommit, push,
  };
}
