import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
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
    const repoRoot = await resolveRepoRoot(rootPath);
    const absPath = path.resolve(path.join(repoRoot, relPath));
    // Guard against path traversal
    if (!absPath.startsWith(repoRoot + path.sep) && absPath !== repoRoot) {
      return res.status(400).json({ error: 'Path outside repository' });
    }
    if (isUntracked) {
      await fs.promises.unlink(absPath);
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
