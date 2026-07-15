import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { rootPath } from '../state';

const router = Router();

router.post('/files/create', async (req, res) => {
  const { path: filePath, type } = req.body as { path?: string; type?: 'file' | 'directory' };

  if (!filePath || (type !== 'file' && type !== 'directory')) {
    return res.status(400).json({ error: 'path and type ("file" | "directory") are required' });
  }

  const currentRoot = rootPath;
  if (!currentRoot) return res.status(400).json({ error: 'No workspace open' });

  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(currentRoot + path.sep) && resolved !== currentRoot) {
    return res.status(400).json({ error: 'Path outside workspace' });
  }

  // Check for existence first — never overwrite
  try {
    await fs.promises.access(resolved);
    return res.status(409).json({ error: `"${path.basename(resolved)}" already exists` });
  } catch {
    // doesn't exist — proceed
  }

  try {
    if (type === 'directory') {
      await fs.promises.mkdir(resolved);
    } else {
      await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
      await fs.promises.writeFile(resolved, '', 'utf-8');
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.post('/files/rename', async (req, res) => {
  const { oldPath, newName } = req.body as { oldPath?: string; newName?: string };

  if (!oldPath || !newName) {
    return res.status(400).json({ error: 'oldPath and newName are required' });
  }

  const currentRoot = rootPath;
  if (!currentRoot) return res.status(400).json({ error: 'No workspace open' });

  const resolvedOld = path.resolve(oldPath);
  if (!resolvedOld.startsWith(currentRoot + path.sep) && resolvedOld !== currentRoot) {
    return res.status(400).json({ error: 'Path outside workspace' });
  }

  const newPath = path.join(path.dirname(resolvedOld), newName);
  if (!newPath.startsWith(currentRoot + path.sep) && newPath !== currentRoot) {
    return res.status(400).json({ error: 'New path outside workspace' });
  }

  // Check source exists
  try {
    await fs.promises.access(resolvedOld);
  } catch {
    return res.status(404).json({ error: `"${path.basename(resolvedOld)}" does not exist` });
  }

  // Same collision check as create — 409 if target already exists
  try {
    await fs.promises.access(newPath);
    return res.status(409).json({ error: `"${newName}" already exists` });
  } catch {
    // doesn't exist — proceed
  }

  try {
    await fs.promises.rename(resolvedOld, newPath);
    return res.json({ ok: true, newPath });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
