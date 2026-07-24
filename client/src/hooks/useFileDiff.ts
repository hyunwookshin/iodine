import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFileDiff, fetchFileDiffWithContent, type DiffData } from '../api/files';

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

  /** Force an immediate content-based refresh (used after in-editor reverts). */
  const refreshDiff = useCallback(async () => {
    const path = filePathRef.current;
    if (!path) { setDiff(null); return; }
    try {
      const data = await fetchFileDiffWithContent(path, contentRef.current);
      setDiff(data);
    } catch {
      setDiff(null);
    }
  }, []);

  useEffect(() => {
    if (!filePath) { setDiff(null); return; }

    let cancelled = false;

    const poll = async () => {
      try {
        const data = await fetchFileDiff(filePath);
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
  }, [filePath]);

  return { diff, refreshDiff };
}
