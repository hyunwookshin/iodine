import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { buildTree, readFileContent, writeFileContent } from '../services/fileSystem';
import { rootPath, setRootPath } from '../state';

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

export default router;
