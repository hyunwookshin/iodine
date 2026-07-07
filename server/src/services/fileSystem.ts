import fs from 'fs';
import path from 'path';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: FileNode[] | null;
}

const IGNORED = new Set([
  'node_modules', '.git', 'dist', 'build', '.next',
  '__pycache__', '.DS_Store', '.turbo', 'coverage',
]);

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'webp',
  'mp4', 'mp3', 'wav', 'ogg', 'webm',
  'zip', 'tar', 'gz', 'rar', '7z',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'exe', 'dll', 'so', 'dylib',
  'db', 'sqlite', 'sqlite3',
]);

export function validatePath(filePath: string, rootPath: string): void {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw Object.assign(new Error('Path is outside workspace root'), { code: 'OUTSIDE_ROOT' });
  }
}

export async function buildTree(dirPath: string, depth = 0, maxDepth = 6): Promise<FileNode> {
  const name = path.basename(dirPath);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(dirPath);
  } catch {
    return { name, path: dirPath, type: 'file', children: null };
  }

  if (!stat.isDirectory() || depth >= maxDepth) {
    return { name, path: dirPath, type: 'file', children: null };
  }

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return { name, path: dirPath, type: 'directory', children: [] };
  }

  const filtered = entries.filter(e => !IGNORED.has(e.name));
  filtered.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const children = await Promise.all(
    filtered.map(e => buildTree(path.join(dirPath, e.name), depth + 1, maxDepth))
  );

  return { name, path: dirPath, type: 'directory', children };
}

export function isBinaryExtension(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export async function readFileContent(filePath: string, rootPath: string): Promise<string> {
  validatePath(filePath, rootPath);
  if (isBinaryExtension(filePath)) {
    throw Object.assign(new Error('Binary file cannot be opened as text'), { code: 'BINARY_FILE' });
  }
  return fs.promises.readFile(filePath, 'utf-8');
}

export async function writeFileContent(filePath: string, content: string, rootPath: string): Promise<void> {
  validatePath(filePath, rootPath);
  await fs.promises.writeFile(filePath, content, 'utf-8');
}
