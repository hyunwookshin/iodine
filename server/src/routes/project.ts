import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { rootPath } from '../state';

const router = express.Router();
const execFileAsync = promisify(execFile);

function workspaceCacheDir(): string | null {
  if (!rootPath) return null;
  const wh = crypto.createHash('md5').update(rootPath).digest('hex');
  return path.join(os.homedir(), '.iodine', wh);
}

/**
 * Get the current git commit hash (HEAD)
 */
async function getGitCommitHash(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: rootPath! });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get the current git diff (staged + unstaged changes)
 */
async function getGitDiff(): Promise<string | null> {
  try {
    // Get all diffs (both staged and unstaged)
    const { stdout } = await execFileAsync('git', ['diff', 'HEAD'], { cwd: rootPath! });
    return stdout;
  } catch {
    return null;
  }
}

// GET /api/project/metadata/download
// Streams a zip of ~/.iodine/<workspace-md5>/ as a downloadable file.
// Includes git-commit and git-diff files at the root of the zip.
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

  try {
    // Get git info
    const commitHash = await getGitCommitHash();
    const gitDiff = await getGitDiff();

    // Create a temporary directory to hold git metadata files
    const tmpMetaDir = path.join(os.tmpdir(), `iodine-meta-${Date.now()}`);
    await fs.promises.mkdir(tmpMetaDir, { recursive: true });

    try {
      // Write git metadata files
      if (commitHash) {
        await fs.promises.writeFile(path.join(tmpMetaDir, 'git-commit'), commitHash);
      }
      if (gitDiff) {
        await fs.promises.writeFile(path.join(tmpMetaDir, 'git-diff'), gitDiff);
      }

      // Use a temporary working directory to create the zip
      const tmpWorkDir = path.join(os.tmpdir(), `iodine-zip-${Date.now()}`);
      await fs.promises.mkdir(tmpWorkDir, { recursive: true });

      try {
        // Copy cache dir contents
        await execFileAsync('cp', ['-r', '.', path.join(tmpWorkDir, 'metadata')], { cwd: cacheDir });

        // Copy git metadata files to root
        if (commitHash) {
          await execFileAsync('cp', [path.join(tmpMetaDir, 'git-commit'), path.join(tmpWorkDir, 'git-commit')]);
        }
        if (gitDiff) {
          await execFileAsync('cp', [path.join(tmpMetaDir, 'git-diff'), path.join(tmpWorkDir, 'git-diff')]);
        }

        // Create zip from tmpWorkDir (this puts everything at root + metadata/)
        const zipProcess = spawn('zip', ['-r', '-', '.'], { cwd: tmpWorkDir });

        zipProcess.stderr.on('data', () => {}); // suppress zip progress output

        zipProcess.on('error', (err) => {
          if (!res.headersSent) {
            res.status(500).json({ error: `zip failed: ${err.message}` });
          } else {
            res.destroy();
          }
        });

        zipProcess.on('close', () => {
          // Clean up temp directories
          fs.promises.rm(tmpWorkDir, { recursive: true, force: true }).catch(() => {});
        });

        zipProcess.stdout.pipe(res);
      } catch (err) {
        await fs.promises.rm(tmpWorkDir, { recursive: true, force: true }).catch(() => {});
        throw err;
      }
    } finally {
      await fs.promises.rm(tmpMetaDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: (err as Error).message });
    } else {
      res.destroy();
    }
  }
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

// DELETE /api/project/metadata
// Removes the entire ~/.iodine/<workspace-md5>/ cache directory.
router.delete('/metadata', async (_req, res) => {
  const cacheDir = workspaceCacheDir();
  if (!cacheDir) {
    return res.status(400).json({ error: 'No workspace open' });
  }

  try {
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
