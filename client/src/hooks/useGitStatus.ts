import { useState, useEffect, useCallback } from 'react';
import { fetchGitStatus, type GitFileStatus } from '../api/files';

export type { GitFileStatus };

export function useGitStatus(workspacePath: string | null): Record<string, GitFileStatus> {
  const [gitStatus, setGitStatus] = useState<Record<string, GitFileStatus>>({});

  const refresh = useCallback(async () => {
    if (!workspacePath) { setGitStatus({}); return; }
    try {
      setGitStatus(await fetchGitStatus());
    } catch {
      setGitStatus({});
    }
  }, [workspacePath]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  return gitStatus;
}
