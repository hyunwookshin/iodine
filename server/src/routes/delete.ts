import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { rootPath } from '../state';

const router = Router();

router.delete('/files', async (req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });

  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'path query param is required' });

  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(rootPath + path.sep) && resolved !== rootPath) {
    return res.status(400).json({ error: 'Path outside workspace' });
  }

  try {
    const stat = await fs.promises.stat(resolved);
    if (stat.isDirectory()) {
      await fs.promises.rm(resolved, { recursive: true });
    } else {
      await fs.promises.unlink(resolved);
    }
    return res.json({ ok: true });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    return res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
