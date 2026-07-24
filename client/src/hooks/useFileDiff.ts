import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFileDiffWithContent, type DiffData } from '../api/files';

export type { DiffData };

export function useFileDiff(
  filePath: string | null,
  content: string,
): { diff: DiffData | null; refreshDiff: () => void } {
  const [diff, setDiff] = useState<DiffData | null>(null);
  const filePathRef = useRef(filePath);
  const contentRef = useRef(content);
  filePathRef.current = filePath;
  contentRef.current = content;

  const fetchDiff = useCallback(async (): Promise<DiffData | null> => {
    const path = filePathRef.current;
    if (!path) return null;
    return fetchFileDiffWithContent(path, contentRef.current);
  }, []);

  /** Force an immediate content-based refresh (used after in-editor reverts). */
  const refreshDiff = useCallback(async () => {
    try {
      const data = await fetchDiff();
      setDiff(data);
    } catch {
      setDiff(null);
    }
  }, [fetchDiff]);

  useEffect(() => {
    if (!filePath) { setDiff(null); return; }

    let cancelled = false;

    const poll = async () => {
      try {
        const data = await fetchDiff();
        if (!cancelled) setDiff(data);
      } catch {
        if (!cancelled) setDiff(null);
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    window.addEventListener('focus', poll);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', poll);
    };
  }, [filePath, fetchDiff]);

  return { diff, refreshDiff };
}
