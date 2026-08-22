import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { buildTree, readFileContent, writeFileContent, readExternalFile, writeExternalFile } from '../services/fileSystem';
import { rootPath, setRootPath, clearRootPath } from '../state';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * One contiguous change, modelled the way an editor's SCM gutter needs it:
 * "the working-copy range [startLine, startLine + lineCount) replaces `originalLines`".
 *
 * - `added`    → `originalLines` is empty (nothing was there before)
 * - `deleted`  → `lineCount` is 0, and `startLine` is the working-copy line the
 *                removed text used to follow (0 when it was the top of the file)
 * - `modified` → both sides are non-empty, and the two sides need not be the
 *                same length (e.g. two lines collapsed into one)
 *
 * Keeping both sides of a hunk together is what lets a single gutter marker,
 * a single preview and a single revert describe the whole change. Splitting a
 * mixed hunk into per-line "added"/"modified"/"deleted" buckets cannot represent
 * an unbalanced edit and produces markers that each restore only half of it.
 */
type DiffHunk = {
  startLine: number;
  lineCount: number;
  originalLines: string[];
  type: 'added' | 'modified' | 'deleted';
};
type DiffResult = { hunks: DiffHunk[] };

function parseDiff(diffOutput: string): DiffResult {
  const hunks: DiffHunk[] = [];

  const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  const lines = diffOutput.split('\n');
  let newLine = 0;
  let inHunk = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('diff --git')) { inHunk = false; i++; continue; }

    const hunkMatch = line.match(hunkRe);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10);
      inHunk = true;
      i++; continue;
    }

    // Everything before the first @@ is file-level header noise. Skipping on
    // this flag (rather than matching '--- '/'+++ ' prefixes) means a removed
    // line whose own content starts with "--" is not mistaken for a header.
    if (!inHunk) { i++; continue; }

    // Collect a contiguous change block (consecutive - and + lines)
    if (line.startsWith('-') || line.startsWith('+')) {
      const originalLines: string[] = [];
      const plusLineNos: number[] = [];

      while (i < lines.length && (lines[i].startsWith('-') || lines[i].startsWith('+'))) {
        if (lines[i].startsWith('-')) {
          originalLines.push(lines[i].slice(1));
        } else {
          plusLineNos.push(newLine++);
        }
        i++;
      }

      if (originalLines.length === 0) {
        hunks.push({ startLine: plusLineNos[0], lineCount: plusLineNos.length, originalLines: [], type: 'added' });
      } else if (plusLineNos.length === 0) {
        hunks.push({ startLine: Math.max(0, newLine - 1), lineCount: 0, originalLines, type: 'deleted' });
      } else {
        hunks.push({ startLine: plusLineNos[0], lineCount: plusLineNos.length, originalLines, type: 'modified' });
      }
      continue;
    }

    // Context line
    if (line.startsWith(' ')) newLine++;
    i++;
  }

  return { hunks };
}

// ── Helper to convert git remote URL to HTTPS GitHub URL ────────────────────

function remoteUrlToGithubUrl(remoteUrl: string): string | null {
  // Handle SSH format: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/git@github\.com:(.+?)\/(.+?)(\.git)?$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;
  }

  // Handle HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/https:\/\/github\.com\/(.+?)\/(.+?)(\.git)?$/);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  // Not a GitHub URL
  return null;
}

// ── Helper to extract branch/tag name from ref ────────────────────────────────

function extractRefName(ref: string): string | null {
  // Ref format examples: "origin/main", "tag: v1.0", "HEAD", "main"
  if (ref.startsWith('tag: ')) {
    return ref.slice('tag: '.length);
  }
  if (ref.includes('/')) {
    // Remote reference: extract the part after the remote name
    const parts = ref.split('/');
    if (parts.length >= 2) {
      return parts.slice(1).join('/');
    }
  }
  // Local branch
  return ref;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

router.post('/workspace/open', async (req, res) => {
  const { path: inputPath } = req.body as { path?: string };
  if (!inputPath) {
    return res.status(400).json({ error: 'path is required' });
  }
  try {
    const stat = await fs.promises.stat(inputPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
    setRootPath(path.resolve(inputPath));
    return res.json({ path: rootPath, name: path.basename(rootPath!) });
  } catch {
    return res.status(400).json({ error: 'Path does not exist or is not accessible' });
  }
});

router.post('/workspace/close', (_req, res) => {
  clearRootPath();
  return res.json({ ok: true });
});

router.post('/workspace/find', async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name) return res.status(400).json({ error: 'name is required' });

  const home = os.homedir();

  // Directories to skip when scanning — avoids descending into heavy or irrelevant trees
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'vendor', '.cache']);

  async function isDir(p: string): Promise<boolean> {
    try { return (await fs.promises.stat(p)).isDirectory(); } catch { return false; }
  }

  async function listSubdirs(dir: string): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
        .map(e => path.join(dir, e.name));
    } catch { return []; }
  }

  // Level 1: ~/name
  if (await isDir(path.join(home, name))) return res.json({ path: path.join(home, name) });

  // Level 2: ~/*/name
  const level1 = await listSubdirs(home);
  for (const dir of level1) {
    if (await isDir(path.join(dir, name))) return res.json({ path: path.join(dir, name) });
  }

  // Level 3: ~/*/*/name — cap total subdirectory checks to avoid excessive I/O
  let checked = 0;
  const MAX_LEVEL3 = 300;
  outer: for (const dir of level1) {
    for (const subdir of await listSubdirs(dir)) {
      if (checked++ >= MAX_LEVEL3) break outer;
      if (await isDir(path.join(subdir, name))) return res.json({ path: path.join(subdir, name) });
    }
  }

  return res.json({ path: null });
});

router.get('/workspace', (_req, res) => {
  if (!rootPath) {
    return res.json({ path: null, name: null });
  }
  return res.json({ path: rootPath, name: path.basename(rootPath) });
});

router.get('/files/tree', async (_req, res) => {
  if (!rootPath) {
    return res.status(400).json({ error: 'No workspace open' });
  }
  try {
    const tree = await buildTree(rootPath);
    return res.json({ tree });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read directory tree' });
  }
});

router.get('/files/content', async (req, res) => {
  if (!rootPath) {
    return res.status(400).json({ error: 'No workspace open' });
  }
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ error: 'path query param is required' });
  }
  try {
    const content = await readFileContent(filePath, rootPath);
    return res.json({ path: filePath, content, encoding: 'utf-8' });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { code?: string };
    if (e.code === 'OUTSIDE_ROOT') return res.status(400).json({ error: e.message });
    if (e.code === 'BINARY_FILE') return res.status(400).json({ error: e.message });
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    return res.status(500).json({ error: 'Failed to read file' });
  }
});

router.put('/files/content', async (req, res) => {
  if (!rootPath) {
    return res.status(400).json({ error: 'No workspace open' });
  }
  const { path: filePath, content } = req.body as { path?: string; content?: string };
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'path and content are required' });
  }
  try {
    await writeFileContent(filePath, content, rootPath);
    return res.json({ path: filePath, savedAt: new Date().toISOString() });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { code?: string };
    if (e.code === 'OUTSIDE_ROOT') return res.status(400).json({ error: e.message });
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    return res.status(500).json({ error: 'Failed to write file' });
  }
});

// ── Locate a file by name across common directories ────────────────────────────

const LOCATE_IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.DS_Store', 'coverage', '.turbo']);

function locateFile(filename: string, roots: string[], maxDepth: number, maxResults: number): string[] {
  const results: string[] = [];
  function search(dir: string, depth: number) {
    if (results.length >= maxResults || depth > maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= maxResults) return;
      if (LOCATE_IGNORED.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { search(full, depth + 1); }
      else if (e.name === filename) { results.push(full); }
    }
  }
  for (const root of roots) {
    if (results.length >= maxResults) break;
    search(root, 0);
  }
  return results;
}

router.post('/files/locate', (req, res) => {
  const { filename, contentHash } = req.body as { filename?: string; contentHash?: string };
  if (!filename) return res.status(400).json({ error: 'filename required' });

  const home = os.homedir();
  const roots: string[] = [];
  if (rootPath) roots.push(rootPath);
  const locateSubs = ['Desktop', 'Documents', 'Downloads', 'Projects', 'projects', 'code', 'dev', 'src', 'repos'];
  if (process.platform === 'win32') locateSubs.push('OneDrive', 'OneDrive - Personal', 'OneDrive - Business');
  for (const sub of locateSubs) {
    const p = path.join(home, sub);
    try { if (fs.statSync(p).isDirectory()) roots.push(p); } catch { /* skip */ }
  }

  let candidates = locateFile(filename, roots, 6, 20);

  // Narrow by SHA-256 hash — computed from raw bytes, completely unambiguous
  if (contentHash && candidates.length > 1) {
    const matched = candidates.filter(p => {
      try {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        return hash === contentHash;
      } catch { return false; }
    });
    if (matched.length > 0) candidates = matched;
  }

  return res.json({ paths: candidates.slice(0, 5) });
});

// ── File search (substring match across workspace + common dirs) ───────────────

type SearchRoot = { dir: string; maxDepth: number; includeHidden?: boolean };

function searchFiles(query: string, roots: SearchRoot[], maxResults: number): string[] {
  const lower = query.toLowerCase();
  const results: string[] = [];
  function walk(dir: string, depth: number, maxDepth: number, includeHidden: boolean) {
    if (results.length >= maxResults || depth > maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= maxResults) return;
      // Always skip noisy dirs when recursing; skip hidden files unless includeHidden
      if (e.isDirectory()) {
        if (LOCATE_IGNORED.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), depth + 1, maxDepth, includeHidden);
      } else {
        if (!includeHidden && e.name.startsWith('.')) continue;
        if (LOCATE_IGNORED.has(e.name)) continue;
        if (e.name.toLowerCase().includes(lower)) results.push(path.join(dir, e.name));
      }
    }
  }
  for (const root of roots) {
    if (results.length >= maxResults) break;
    walk(root.dir, 0, root.maxDepth, root.includeHidden ?? false);
  }
  return results;
}

router.post('/files/search', (req, res) => {
  const { query, workspaceOnly } = req.body as { query?: string; workspaceOnly?: boolean };
  if (!query || query.trim().length < 1) return res.json({ paths: [] });

  const roots: SearchRoot[] = [];
  if (workspaceOnly) {
    if (!rootPath) return res.json({ paths: [] });
    roots.push({ dir: rootPath, maxDepth: 6 });
  } else {
    const home = os.homedir();
    if (rootPath) roots.push({ dir: rootPath, maxDepth: 6 });
    // Home dir at depth 0 with hidden files included (e.g. .bashrc, .zshrc)
    roots.push({ dir: home, maxDepth: 0, includeHidden: true });
    const commonSubs = ['Desktop', 'Documents', 'Downloads', 'Projects', 'projects', 'code', 'dev', 'src', 'repos'];
    if (process.platform === 'win32') commonSubs.push('OneDrive', 'OneDrive - Personal', 'OneDrive - Business');
    for (const sub of commonSubs) {
      const p = path.join(home, sub);
      try { if (fs.statSync(p).isDirectory()) roots.push({ dir: p, maxDepth: 6 }); } catch { /* skip */ }
    }
  }

  const paths = searchFiles(query.trim(), roots, 30);
  return res.json({ paths });
});

// ── External file access (any absolute path, no workspace boundary) ───────────

router.get('/files/external', async (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath || !path.isAbsolute(filePath)) {
    return res.status(400).json({ error: 'Absolute path query param required' });
  }
  try {
    const content = await readExternalFile(filePath);
    return res.json({ path: filePath, content, encoding: 'utf-8' });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { code?: string };
    if (e.code === 'BINARY_FILE') return res.status(400).json({ error: e.message });
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    return res.status(500).json({ error: 'Failed to read file' });
  }
});

router.put('/files/external', async (req, res) => {
  const { path: filePath, content } = req.body as { path?: string; content?: string };
  if (!filePath || !path.isAbsolute(filePath) || content === undefined) {
    return res.status(400).json({ error: 'Absolute path and content are required' });
  }
  try {
    await writeExternalFile(filePath, content);
    return res.json({ path: filePath, savedAt: new Date().toISOString() });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    return res.status(500).json({ error: 'Failed to write file' });
  }
});

// ── Image viewer ──────────────────────────────────────────────────────────────

router.get('/files/image', async (req, res) => {
  if (!rootPath) {
    return res.status(400).json({ error: 'No workspace open' });
  }
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ error: 'path query param is required' });
  }

  // Resolve and guard against path traversal
  const resolved = path.resolve(filePath);
  // Resolve symlinks so a symlink inside workspace pointing outside is caught
  const realResolved = fs.realpathSync(resolved);
  const realRoot = fs.realpathSync(rootPath);
  if (!realResolved.startsWith(realRoot + path.sep) && realResolved !== realRoot) {
    return res.status(400).json({ error: 'Path outside workspace' });
  }

  const ext = resolved.split('.').pop()?.toLowerCase() ?? '';
  const mime = IMAGE_MIME[ext];
  if (!mime) {
    return res.status(400).json({ error: 'Unsupported image type' });
  }

  try {
    const data = await fs.promises.readFile(resolved);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(data);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    return res.status(500).json({ error: 'Failed to read image' });
  }
});

// ── PDF viewer ────────────────────────────────────────────────────────────────

router.get('/files/pdf', async (req, res) => {
  if (!rootPath) {
    return res.status(400).json({ error: 'No workspace open' });
  }
  const filePath = req.query.path as string;
  if (!filePath) {
    return res.status(400).json({ error: 'path query param is required' });
  }

  // Resolve and guard against path traversal
  const resolved = path.resolve(filePath);
  // Resolve symlinks so a symlink inside workspace pointing outside is caught
  const realResolved = fs.realpathSync(resolved);
  const realRoot = fs.realpathSync(rootPath);
  if (!realResolved.startsWith(realRoot + path.sep) && realResolved !== realRoot) {
    return res.status(400).json({ error: 'Path outside workspace' });
  }

  const ext = resolved.split('.').pop()?.toLowerCase() ?? '';
  if (ext !== 'pdf') {
    return res.status(400).json({ error: 'Only PDF files are supported' });
  }

  try {
    const data = await fs.promises.readFile(resolved);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(data);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    return res.status(500).json({ error: 'Failed to read PDF' });
  }
});

// ── Git diff & status ─────────────────────────────────────────────────────────

router.get('/git/diff', async (req, res) => {
  if (!rootPath) return res.json({ hunks: [] });
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  try {
    const { stdout } = await execFileAsync('git', ['diff', 'HEAD', '--', filePath], { cwd: rootPath });
    return res.json(parseDiff(stdout));
  } catch {
    return res.json({ hunks: [] });
  }
});

/** Diff provided editor content against HEAD (no disk I/O required on the client side). */
router.post('/git/diff', async (req, res) => {
  if (!rootPath) return res.json({ hunks: [] });
  const { path: filePath, content } = req.body as { path: string; content: string };
  if (!filePath || content === undefined) return res.status(400).json({ error: 'path and content required' });

  const relPath = path.relative(rootPath, filePath);

  let headContent: string;
  try {
    // `HEAD:<path>` resolves against the repo root, not `cwd` — but the `./` prefix
    // tells git to resolve it relative to `cwd` instead, which matters whenever the
    // open workspace (rootPath) is a subdirectory of the git repo root.
    const r = await execFileAsync('git', ['show', `HEAD:./${relPath.replace(/\\/g, '/')}`], { cwd: rootPath });
    headContent = r.stdout;
  } catch {
    // File not tracked in HEAD — treat as fully new, no diff to show
    return res.json({ hunks: [] });
  }

  const tmpA = path.join(os.tmpdir(), `iodine-head-${Date.now()}`);
  const tmpB = path.join(os.tmpdir(), `iodine-edit-${Date.now()}`);
  try {
    await Promise.all([fs.promises.writeFile(tmpA, headContent), fs.promises.writeFile(tmpB, content)]);
    let diffOut = '';
    try {
      const r = await execFileAsync('git', ['diff', '--no-index', '--', tmpA, tmpB]);
      diffOut = r.stdout;
    } catch (e: unknown) {
      // git diff --no-index exits with code 1 when files differ; stdout still has the diff
      diffOut = (e as { stdout?: string }).stdout ?? '';
    }
    return res.json(parseDiff(diffOut));
  } finally {
    await Promise.all([
      fs.promises.rm(tmpA, { force: true }).catch(() => {}),
      fs.promises.rm(tmpB, { force: true }).catch(() => {}),
    ]);
  }
});

/** Overall unstaged diff across the whole workspace — used by proactive help detector. */
router.get('/git/diff/all', async (_req, res) => {
  if (!rootPath) return res.json({ diff: '', lineCount: 0 });
  try {
    const { stdout } = await execFileAsync('git', ['diff'], { cwd: rootPath });
    return res.json({ diff: stdout, lineCount: stdout.split('\n').length });
  } catch {
    return res.json({ diff: '', lineCount: 0 });
  }
});

router.get('/git/status', async (_req, res) => {
  if (!rootPath) return res.json({ status: {} });

  try {
    const { stdout: rootOut } = await execAsync('git rev-parse --show-toplevel', { cwd: rootPath });
    const repoRoot = rootOut.trim();

    const { stdout } = await execAsync('git status --porcelain', { cwd: rootPath });

    const status: Record<string, 'unstaged' | 'staged' | 'both'> = {};

    for (const line of stdout.split('\n')) {
      if (line.length < 3) continue;
      const X = line[0]; // index (staged)
      const Y = line[1]; // working tree (unstaged)
      let filePath = line.slice(3).trim();
      // Rename format: "old -> new" — use the new path
      if (filePath.includes(' -> ')) filePath = filePath.split(' -> ')[1];

      const absPath = path.join(repoRoot, filePath);
      // Untracked files/dirs ("??") are working-copy changes too — mark them
      // 'unstaged' so the file explorer highlights them like the SCM panel does.
      if (X === '?' && Y === '?') {
        status[absPath] = 'unstaged';
        continue;
      }
      const isStaged   = X !== ' ';
      const isUnstaged = Y !== ' ';

      if (isStaged && isUnstaged) status[absPath] = 'both';
      else if (isStaged)          status[absPath] = 'staged';
      else if (isUnstaged)        status[absPath] = 'unstaged';
    }

    return res.json({ status });
  } catch {
    return res.json({ status: {} });
  }
});

// --- Source Control operations ---

type ChangeStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '??';
interface GitChange { path: string; relPath: string; status: ChangeStatus; }

async function resolveRepoRoot(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
  return stdout.trim();
}

router.get('/git/changes', async (_req, res) => {
  if (!rootPath) return res.json({ branch: '', staged: [], unstaged: [] });

  try {
    const repoRoot = await resolveRepoRoot(rootPath);
    const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootPath });
    const branch = branchOut.trim();
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: rootPath });

    const staged: GitChange[] = [];
    const unstaged: GitChange[] = [];

    for (const line of stdout.split('\n')) {
      if (line.length < 3) continue;
      const X = line[0];
      const Y = line[1];
      let relPath = line.slice(3).trim();
      if (relPath.includes(' -> ')) relPath = relPath.split(' -> ')[1];
      const absPath = path.join(repoRoot, relPath);

      if (X === '?' && Y === '?') {
        unstaged.push({ path: absPath, relPath, status: '??' });
      } else {
        if (X !== ' ') staged.push({ path: absPath, relPath, status: X as ChangeStatus });
        if (Y !== ' ') unstaged.push({ path: absPath, relPath, status: Y as ChangeStatus });
      }
    }

    return res.json({ branch, staged, unstaged });
  } catch {
    return res.json({ branch: '', staged: [], unstaged: [] });
  }
});

router.post('/git/stage', async (req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  const { relPath } = req.body as { relPath?: string };
  if (!relPath) return res.status(400).json({ error: 'relPath is required' });
  try {
    const repoRoot = await resolveRepoRoot(rootPath);
    const absPath = path.resolve(path.join(repoRoot, relPath));
    await execFileAsync('git', ['add', '--', absPath], { cwd: rootPath });
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/git/unstage', async (req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  const { relPath } = req.body as { relPath?: string };
  if (!relPath) return res.status(400).json({ error: 'relPath is required' });
  try {
    const repoRoot = await resolveRepoRoot(rootPath);
    const absPath = path.resolve(path.join(repoRoot, relPath));
    await execFileAsync('git', ['restore', '--staged', '--', absPath], { cwd: rootPath });
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/git/stage-all', async (_req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  try {
    await execFileAsync('git', ['add', '-A'], { cwd: rootPath });
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/git/discard', async (req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  const { relPath, isUntracked } = req.body as { relPath?: string; isUntracked?: boolean };
  if (!relPath) return res.status(400).json({ error: 'relPath is required' });
  try {
    // path.resolve normalizes git's forward slashes to native separators (Windows)
    const repoRoot = path.resolve(await resolveRepoRoot(rootPath));
    const absPath = path.resolve(repoRoot, relPath);
    // Guard against path traversal
    if (!absPath.startsWith(repoRoot + path.sep) && absPath !== repoRoot) {
      return res.status(400).json({ error: 'Path outside repository' });
    }
    if (isUntracked) {
      // Untracked entries can be whole directories ("?? dir/") — rm handles both files and dirs
      await fs.promises.rm(absPath, { recursive: true, force: true });
    } else {
      await execFileAsync('git', ['restore', '--', absPath], { cwd: rootPath });
    }
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/git/commit', async (req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  const { message } = req.body as { message?: string };
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' });
  try {
    await execFileAsync('git', ['commit', '-m', message], { cwd: rootPath });
    return res.json({ ok: true });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message: string };
    return res.status(500).json({ error: e.stderr ?? e.message });
  }
});

router.post('/git/pull', async (req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });

  // Check for unstaged changes (ignore untracked files)
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: rootPath });
    const unstagedChanges = stdout
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('??')); // Filter out untracked files
    
    if (unstagedChanges.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot pull with unstaged changes. Please commit or stash them first.',
        status: 'unstaged_changes'
      });
    }

    // Execute git pull --rebase
    await execFileAsync('git', ['pull', '--rebase'], { cwd: rootPath });
    return res.json({ 
      ok: true, 
      status: 'success',
      message: 'Successfully pulled latest changes with rebase'
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message: string };
    return res.status(500).json({ 
      ok: false,
      status: 'pull_failed',
      error: e.stderr ?? e.message 
    });
  }
});

// --- Git remote URL for opening on GitHub ---

router.get('/git/remote-url', async (_req, res) => {
  if (!rootPath) return res.json({ url: null, githubUrl: null });

  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], { cwd: rootPath });
    const url = stdout.trim();
    const githubUrl = remoteUrlToGithubUrl(url);
    return res.json({ url, githubUrl });
  } catch {
    return res.json({ url: null, githubUrl: null });
  }
});

// --- Endpoint to get GitHub URL for a specific ref (branch/tag) ---

router.get('/git/ref-url', async (req, res) => {
  if (!rootPath) return res.json({ githubUrl: null, refName: null });

  const ref = req.query.ref as string;
  if (!ref) return res.status(400).json({ error: 'ref query param is required' });

  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], { cwd: rootPath });
    const remoteUrl = stdout.trim();
    const baseGithubUrl = remoteUrlToGithubUrl(remoteUrl);

    if (!baseGithubUrl) return res.json({ githubUrl: null, refName: null });

    const refName = extractRefName(ref);
    if (!refName) return res.json({ githubUrl: null, refName: null });

    // Build the GitHub URL with the branch/tag
    // Format: https://github.com/owner/repo/tree/branch or /releases/tag/tag-name
    let githubUrl = baseGithubUrl;
    if (ref.startsWith('tag: ')) {
      githubUrl += `/releases/tag/${encodeURIComponent(refName)}`;
    } else {
      githubUrl += `/tree/${encodeURIComponent(refName)}`;
    }

    return res.json({ githubUrl, refName });
  } catch {
    return res.json({ githubUrl: null, refName: null });
  }
});

// --- Git log and branch tree ---

// Field separator unlikely to appear in git output values
const GIT_SEP = '\x1f';

router.get('/git/log', async (_req, res) => {
  if (!rootPath) return res.json({ commits: [] });
  try {
    const fmt = `%H${GIT_SEP}%h${GIT_SEP}%P${GIT_SEP}%s${GIT_SEP}%an${GIT_SEP}%ar${GIT_SEP}%D`;
    const { stdout } = await execFileAsync(
      'git', ['log', '--all', `--format=${fmt}`, '--max-count=80'],
      { cwd: rootPath },
    );

    const commits = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [hash, shortHash, parents, message, author, relativeDate, refsStr] = line.split(GIT_SEP);
      // %D format: "HEAD -> main, origin/main, tag: v1.0"
      const rawRefs = refsStr ? refsStr.split(',').map(r => r.trim()).filter(Boolean) : [];
      const refs: string[] = [];
      for (const r of rawRefs) {
        if (r.startsWith('HEAD -> ')) {
          refs.push('HEAD');
          refs.push(r.slice('HEAD -> '.length));
        } else if (r === 'HEAD') {
          refs.push('HEAD');
        } else {
          refs.push(r);
        }
      }
      return {
        hash: hash ?? '',
        shortHash: shortHash ?? '',
        parentHashes: parents?.trim().split(' ').filter(Boolean) ?? [],
        message: message ?? '',
        author: author ?? '',
        relativeDate: relativeDate ?? '',
        refs,
      };
    });

    return res.json({ commits });
  } catch {
    return res.json({ commits: [] });
  }
});

router.get('/git/commit-diff', async (req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  const hash = req.query.hash as string | undefined;
  if (!hash) return res.status(400).json({ error: 'Missing hash' });
  try {
    const SEP = '\x1f';
    const { stdout: meta } = await execFileAsync(
      'git', ['log', '-1', hash, `--format=%H${SEP}%h${SEP}%s${SEP}%b${SEP}%an${SEP}%ae${SEP}%aI`],
      { cwd: rootPath },
    );
    const [fullHash, shortHash, subject, body, author, email, date] = meta.trim().split(SEP);
    const { stdout: diff } = await execFileAsync(
      'git', ['show', hash, '--format=', '--patch'],
      { cwd: rootPath },
    );
    return res.json({ hash: fullHash, shortHash, subject, body: body?.trim() ?? '', author, email, date, diff });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/git/branches', async (_req, res) => {
  if (!rootPath) return res.json({ local: [], remote: [] });
  try {
    const localFmt = `%(HEAD)${GIT_SEP}%(refname:short)${GIT_SEP}%(objectname:short)${GIT_SEP}%(upstream:short)`;
    const { stdout: localOut } = await execFileAsync(
      'git', ['branch', `--format=${localFmt}`],
      { cwd: rootPath },
    );
    const local = localOut.trim().split('\n').filter(Boolean).map(line => {
      const [head, name, hash, upstream] = line.split(GIT_SEP);
      return { name: name ?? '', shortHash: hash ?? '', isCurrent: head === '*', upstream: upstream || null };
    });

    const remoteFmt = `%(refname:short)${GIT_SEP}%(objectname:short)`;
    const { stdout: remoteOut } = await execFileAsync(
      'git', ['branch', '-r', `--format=${remoteFmt}`],
      { cwd: rootPath },
    );
    const remote = remoteOut.trim().split('\n').filter(Boolean)
      .map(line => { const [name, hash] = line.split(GIT_SEP); return { name: name ?? '', shortHash: hash ?? '' }; })
      .filter(b => !b.name.endsWith('/HEAD'));

    return res.json({ local, remote });
  } catch {
    return res.json({ local: [], remote: [] });
  }
});

router.post('/git/checkout', async (req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  const { branch, detach } = req.body as { branch?: string; detach?: boolean };
  if (!branch) return res.status(400).json({ error: 'branch is required' });
  try {
    // detach=true → 'git switch --detach <hash>' for commit checkout (detached HEAD)
    // detach=false → 'git switch <branch>' (auto-creates local tracking branch if needed)
    const args = detach ? ['switch', '--detach', branch] : ['switch', branch];
    await execFileAsync('git', args, { cwd: rootPath });
    return res.json({ ok: true });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message: string };
    return res.status(500).json({ error: e.stderr ?? e.message });
  }
});

router.post('/git/stash', async (_req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  try {
    await execFileAsync('git', ['stash'], { cwd: rootPath });
    return res.json({ ok: true });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message: string };
    return res.status(500).json({ error: e.stderr ?? e.message });
  }
});

router.post('/git/push', async (_req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  try {
    // --set-upstream establishes tracking if not yet configured
    await execFileAsync('git', ['push', '--set-upstream', 'origin', 'HEAD'], { cwd: rootPath });
    return res.json({ ok: true });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message: string };
    return res.status(500).json({ error: e.stderr ?? e.message });
  }
});

// ── File watcher (SSE) ────────────────────────────────────────────────────────

router.get('/files/watch', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!rootPath) {
    // No workspace yet — keep connection alive; client will reconnect when workspace opens
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    res.on('close', () => clearInterval(ping));
    return;
  }

  const watchRoot = rootPath;
  const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(watchRoot, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      // Skip noise from git internals and dependency directories
      if (filename.startsWith('.git' + path.sep) || filename.startsWith('node_modules' + path.sep)) return;

      const absPath = path.join(watchRoot, filename);
      const existing = debounceMap.get(absPath);
      if (existing) clearTimeout(existing);
      debounceMap.set(absPath, setTimeout(() => {
        debounceMap.delete(absPath);
        // Only emit for files, not directories
        fs.promises.stat(absPath)
          .then(stat => {
            if (stat.isFile()) res.write(`event: file-changed\ndata: ${JSON.stringify({ path: absPath })}\n\n`);
          })
          .catch(() => {
            // File deleted — still notify so editor can react
            res.write(`event: file-changed\ndata: ${JSON.stringify({ path: absPath })}\n\n`);
          });
      }, 150));
    });
  } catch {
    res.write(`event: error\ndata: ${JSON.stringify({ message: 'fs.watch not supported' })}\n\n`);
    res.end();
    return;
  }

  const ping = setInterval(() => res.write(': ping\n\n'), 15000);

  res.on('close', () => {
    watcher.close();
    clearInterval(ping);
    for (const t of debounceMap.values()) clearTimeout(t);
    debounceMap.clear();
  });
});

// ── System graph ──────────────────────────────────────────────────────────────

function graphFilePath(root: string): string {
  const md5 = crypto.createHash('md5').update(root).digest('hex');
  return path.join(os.homedir(), '.iodine', md5, 'system-graph.json');
}

router.get('/system-graph', async (_req, res) => {
  if (!rootPath) return res.json({ graph: null });
  try {
    const data = await fs.promises.readFile(graphFilePath(rootPath), 'utf-8');
    return res.json({ graph: JSON.parse(data) });
  } catch {
    return res.json({ graph: null });
  }
});

router.put('/system-graph', async (req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  const { graph } = req.body as { graph: unknown };
  const fp = graphFilePath(rootPath);
  await fs.promises.mkdir(path.dirname(fp), { recursive: true });
  await fs.promises.writeFile(fp, JSON.stringify(graph, null, 2), 'utf-8');
  return res.json({ ok: true });
});

export default router;
