import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { buildTree, readFileContent, writeFileContent } from '../services/fileSystem';
import { rootPath, setRootPath } from '../state';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

type DeletedBlock = { afterLine: number; lines: string[] };
type DiffResult = { added: number[]; modified: number[]; deleted: DeletedBlock[] };

function parseDiff(diffOutput: string): DiffResult {
  const added: number[] = [];
  const modified: number[] = [];
  const deleted: DeletedBlock[] = [];

  const hunkRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
  const lines = diffOutput.split('\n');
  let newLine = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const hunkMatch = line.match(hunkRe);

    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10);
      i++; continue;
    }

    // Skip file-level header lines
    if (line.startsWith('diff ') || line.startsWith('index ') ||
        line.startsWith('--- ') || line.startsWith('+++ ') ||
        line.startsWith('new file') || line.startsWith('deleted file')) {
      i++; continue;
    }

    // Collect a contiguous change block (consecutive - and + lines)
    if (line.startsWith('-') || line.startsWith('+')) {
      const minusLines: string[] = [];
      const plusLineNos: number[] = [];

      while (i < lines.length && (lines[i].startsWith('-') || lines[i].startsWith('+'))) {
        if (lines[i].startsWith('-')) {
          minusLines.push(lines[i].slice(1));
        } else {
          plusLineNos.push(newLine++);
        }
        i++;
      }

      if (minusLines.length === 0) {
        for (const ln of plusLineNos) added.push(ln);
      } else if (plusLineNos.length === 0) {
        deleted.push({ afterLine: newLine - 1, lines: minusLines });
      } else {
        // Mixed: first overlap lines are "modified"; extras on either side classified individually
        const overlap = Math.min(minusLines.length, plusLineNos.length);
        for (let j = 0; j < overlap; j++) modified.push(plusLineNos[j]);
        for (let j = overlap; j < plusLineNos.length; j++) added.push(plusLineNos[j]);
        if (minusLines.length > plusLineNos.length) {
          deleted.push({
            afterLine: plusLineNos[plusLineNos.length - 1],
            lines: minusLines.slice(plusLineNos.length),
          });
        }
      }
      continue;
    }

    // Context line
    if (line.startsWith(' ')) newLine++;
    i++;
  }

  return { added, modified, deleted };
}

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

router.post('/workspace/find', async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name) return res.status(400).json({ error: 'name is required' });

  const home = os.homedir();

  // First: check direct child of home (~/name)
  const direct = path.join(home, name);
  try {
    const stat = await fs.promises.stat(direct);
    if (stat.isDirectory()) return res.json({ path: direct });
  } catch { /* continue */ }

  // Second: scan all subdirectories of home one level deep (~/*/name)
  try {
    const homeDirs = await fs.promises.readdir(home, { withFileTypes: true });
    for (const entry of homeDirs) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const candidate = path.join(home, entry.name, name);
      try {
        const stat = await fs.promises.stat(candidate);
        if (stat.isDirectory()) return res.json({ path: candidate });
      } catch { /* continue */ }
    }
  } catch { /* continue */ }

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

router.get('/git/diff', async (req, res) => {
  if (!rootPath) return res.json({ added: [], modified: [], deleted: [] });
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  try {
    const { stdout } = await execFileAsync('git', ['diff', 'HEAD', '--', filePath], { cwd: rootPath });
    return res.json(parseDiff(stdout));
  } catch {
    return res.json({ added: [], modified: [], deleted: [] });
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
      const isStaged   = X !== ' ' && X !== '?';
      const isUnstaged = Y !== ' ' && Y !== '?';

      if (isStaged && isUnstaged) status[absPath] = 'both';
      else if (isStaged)          status[absPath] = 'staged';
      else if (isUnstaged)        status[absPath] = 'unstaged';
    }

    return res.json({ status });
  } catch {
    return res.json({ status: {} });
  }
});

export default router;
