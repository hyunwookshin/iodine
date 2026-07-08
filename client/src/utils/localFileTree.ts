import type { FileNode } from '../types';

export interface LocalFileSystem {
  tree: FileNode;
  fileMap: Map<string, File>;
}

/**
 * Builds a FileNode tree from a browser FileList (e.g. from <input webkitdirectory>).
 *
 * Each File's webkitRelativePath (e.g. "myproject/src/index.ts") is used as the node
 * path, making it stable for identity comparisons in useOpenFiles.
 */
export function buildLocalFileTree(files: FileList): LocalFileSystem {
  const fileMap = new Map<string, File>();
  const allFiles = Array.from(files).filter(f => f.webkitRelativePath);

  if (allFiles.length === 0) {
    return { tree: { name: 'Project', path: '', type: 'directory', children: [] }, fileMap };
  }

  const rootName = allFiles[0].webkitRelativePath.split('/')[0];
  const root: FileNode = { name: rootName, path: rootName, type: 'directory', children: [] };

  for (const file of allFiles) {
    const relPath = file.webkitRelativePath; // e.g. "myproject/src/index.ts"
    fileMap.set(relPath, file);

    const parts = relPath.split('/');
    let current = root;

    // Walk/create intermediate directories (skip parts[0] = root, stop before filename)
    for (let i = 1; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/');
      let dir = current.children?.find(c => c.type === 'directory' && c.path === dirPath);
      if (!dir) {
        dir = { name: parts[i], path: dirPath, type: 'directory', children: [] };
        if (!current.children) current.children = [];
        current.children.push(dir);
      }
      current = dir;
    }

    if (!current.children) current.children = [];
    current.children.push({
      name: parts[parts.length - 1],
      path: relPath,
      type: 'file',
      children: null,
    });
  }

  sortNode(root);
  return { tree: root, fileMap };
}

function sortNode(node: FileNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  node.children.forEach(sortNode);
}
