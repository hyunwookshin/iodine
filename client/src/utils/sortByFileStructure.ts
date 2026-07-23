import type { OpenFile } from '../types';

/**
 * Sorts an array of open files by their hierarchical position in the file tree.
 * Uses depth-first tree traversal order, with alphabetical sorting as secondary criterion.
 *
 * @param openFiles - Array of open files to sort
 * @returns A new array sorted by file structure hierarchy
 */
export function sortOpenFilesByStructure(openFiles: OpenFile[]): OpenFile[] {
  if (openFiles.length === 0) return openFiles;

  // Build a map of path to file for quick lookup
  const fileMap = new Map<string, OpenFile>();
  openFiles.forEach(file => {
    fileMap.set(file.path, file);
  });

  // Parse paths into components for comparison
  interface PathInfo {
    file: OpenFile;
    parts: string[];
    depth: number;
  }

  const pathInfos: PathInfo[] = openFiles.map(file => ({
    file,
    parts: file.path.split('/').filter(p => p.length > 0),
    depth: file.path.split('/').filter(p => p.length > 0).length,
  }));

  // Perform depth-first tree traversal order sort
  // 1. Sort by depth first (files higher in tree come first)
  // 2. Within the same depth, sort lexicographically by full path
  const sorted = pathInfos.sort((a, b) => {
    // Primary: compare path parts lexicographically for tree traversal order
    const minLength = Math.min(a.parts.length, b.parts.length);

    for (let i = 0; i < minLength; i++) {
      const comparison = a.parts[i].localeCompare(b.parts[i]);
      if (comparison !== 0) {
        return comparison;
      }
    }

    // If all compared parts are equal, shorter path comes first (parent before child)
    if (a.parts.length !== b.parts.length) {
      return a.parts.length - b.parts.length;
    }

    // Fallback: they're the same path (shouldn't happen)
    return 0;
  });

  return sorted.map(info => info.file);
}
