import fs from 'fs';
import path from 'path';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: FileNode[] | null;
  /** Whether this file or directory is a symbolic link */
  isSymlink?: boolean;
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
  // Resolve symlinks so a symlink inside workspace pointing outside is caught.
  // Walk up to the first existing ancestor so this works for new files too.
  const realRoot = fs.realpathSync(resolvedRoot);
  let candidate = resolved;
  let existingParent: string | null = null;
  while (candidate !== path.dirname(candidate)) {
    try {
      existingParent = fs.realpathSync(candidate);
      break;
    } catch {
      candidate = path.dirname(candidate);
    }
  }
  if (!existingParent) {
    throw Object.assign(new Error('Path is outside workspace root'), { code: 'OUTSIDE_ROOT' });
  }
  // existingParent is the real path of the nearest existing ancestor;
  // append the remaining unresolved tail to reconstruct the full real path.
  const tail = resolved.slice(candidate.length);
  const realResolved = existingParent + tail;
  if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep)) {
    throw Object.assign(new Error('Path is outside workspace root'), { code: 'OUTSIDE_ROOT' });
  }
}

export async function buildTree(dirPath: string, depth = 0, maxDepth = 6): Promise<FileNode> {
  const name = path.basename(dirPath);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(dirPath); // lstat to detect symlinks
  } catch {
    return { name, path: dirPath, type: 'file', children: null };
  }

  const isSymlink = stat.isSymbolicLink();

  if (!stat.isDirectory() || depth >= maxDepth) {
    return { name, path: dirPath, type: 'file', children: null, isSymlink };
  }

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return { name, path: dirPath, type: 'directory', children: [], isSymlink };
  }

  const filtered = entries.filter(e => !IGNORED.has(e.name));
  filtered.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const children = await Promise.all(
    filtered.map(e => buildTree(path.join(dirPath, e.name), depth + 1, maxDepth))
  );

  return { name, path: dirPath, type: 'directory', children, isSymlink };
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

/** Read any absolute path on disk — no workspace boundary check. */
export async function readExternalFile(filePath: string): Promise<string> {
  if (isBinaryExtension(filePath)) {
    throw Object.assign(new Error('Binary file cannot be opened as text'), { code: 'BINARY_FILE' });
  }
  return fs.promises.readFile(filePath, 'utf-8');
}

/** Write any absolute path on disk — no workspace boundary check. */
export async function writeExternalFile(filePath: string, content: string): Promise<void> {
  await fs.promises.writeFile(filePath, content, 'utf-8');
}
