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

export default router;
