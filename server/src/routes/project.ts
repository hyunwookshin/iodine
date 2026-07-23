import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn, execFile } from 'child_process';
import { rootPath } from '../state';

const router = express.Router();

function workspaceCacheDir(): string | null {
  if (!rootPath) return null;
  const wh = crypto.createHash('md5').update(rootPath).digest('hex');
  return path.join(os.homedir(), '.iodine', wh);
}

// GET /api/project/metadata/download
// Streams a zip of ~/.iodine/<workspace-md5>/ as a downloadable file.
router.get('/metadata/download', async (_req, res) => {
  const cacheDir = workspaceCacheDir();
  if (!cacheDir) {
    return res.status(400).json({ error: 'No workspace open' });
  }

  try {
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const entries = await fs.promises.readdir(cacheDir);
    if (entries.length === 0) {
      return res.status(404).json({ error: 'No metadata cached for this workspace yet' });
    }
  } catch {
    return res.status(500).json({ error: 'Failed to access cache directory' });
  }

  const workspaceName = path.basename(rootPath!);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="iodine-${workspaceName}.zip"`);

  const zipProcess = spawn('zip', ['-r', '-', '.'], { cwd: cacheDir });

  zipProcess.stderr.on('data', () => {}); // suppress zip progress output

  zipProcess.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: `zip failed: ${err.message}` });
    } else {
      res.destroy();
    }
  });

  zipProcess.stdout.pipe(res);
});

// POST /api/project/metadata/import
// Accepts a raw zip body and extracts it into ~/.iodine/<workspace-md5>/.
router.post(
  '/metadata/import',
  express.raw({ type: '*/*', limit: '500mb' }),
  async (req, res) => {
    const cacheDir = workspaceCacheDir();
    if (!cacheDir) {
      return res.status(400).json({ error: 'No workspace open' });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'No zip data received' });
    }

    try {
      await fs.promises.mkdir(cacheDir, { recursive: true });
    } catch {
      return res.status(500).json({ error: 'Failed to create cache directory' });
    }

    const tmpFile = path.join(os.tmpdir(), `iodine-import-${Date.now()}.zip`);
    try {
      await fs.promises.writeFile(tmpFile, req.body);

      await new Promise<void>((resolve, reject) => {
        execFile('unzip', ['-o', tmpFile, '-d', cacheDir], (_err, _stdout, stderr) => {
          // unzip exits non-zero for warnings too; only fail on real errors
          if (_err && _err.code !== 1) {
            reject(new Error(stderr.trim() || _err.message));
          } else {
            resolve();
          }
        });
      });

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    } finally {
      await fs.promises.unlink(tmpFile).catch(() => {});
    }
  }
);

export default router;
