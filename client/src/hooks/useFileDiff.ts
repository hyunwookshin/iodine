import { useState, useEffect } from 'react';
import { fetchFileDiff, type DiffData } from '../api/files';

export type { DiffData };

export function useFileDiff(filePath: string | null): DiffData | null {
  const [diff, setDiff] = useState<DiffData | null>(null);

  useEffect(() => {
    if (!filePath) { setDiff(null); return; }

    let cancelled = false;

    const refresh = async () => {
      try {
        const data = await fetchFileDiff(filePath);
        if (!cancelled) setDiff(data);
      } catch {
        if (!cancelled) setDiff(null);
      }
    };

    refresh();
    const interval = setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [filePath]);

  return diff;
}
