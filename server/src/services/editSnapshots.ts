import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validatePath, writeFileContent } from './fileSystem';

const MAX_SNAPSHOT_BYTES = 1024 * 1024;

interface EditSnapshot {
  path: string;
  /** False when the agent created the file, so reverting means deleting it. */
  existed: boolean;
  before: string;
  /** Hash of the file right after the edit, so a later revert can tell if it changed since. */
  afterHash: string;
  tool: string;
  timestamp: number;
}

function hash(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex');
}

function snapshotDir(workspacePath: string): string {
  return path.join(os.homedir(), '.iodine', hash(workspacePath), 'edits');
}

function snapshotFile(workspacePath: string, toolCallId: string): string {
  return path.join(snapshotDir(workspacePath), `${toolCallId}.json`);
}

/**
 * Records a file's contents before an agent edit. Call with the text that is about
 * to be written so afterHash matches what lands on disk. Oversized files are skipped.
 */
export async function saveSnapshot(
  workspacePath: string,
  toolCallId: string,
  absolutePath: string,
  nextContent: string,
  tool: string,
): Promise<void> {
  let before = '';
  let existed = true;
  try {
    before = await fs.promises.readFile(absolutePath, 'utf-8');
  } catch {
    existed = false;
  }
  if (Buffer.byteLength(before, 'utf-8') > MAX_SNAPSHOT_BYTES) return;

  const snapshot: EditSnapshot = {
    path: absolutePath,
    existed,
    before,
    afterHash: hash(nextContent),
    tool,
    timestamp: Date.now(),
  };
  const dir = snapshotDir(workspacePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(snapshotFile(workspacePath, toolCallId), JSON.stringify(snapshot), 'utf-8');
}

export type RevertResult =
  | { outcome: 'not-found' }
  | { outcome: 'stale'; path: string }
  | { outcome: 'reverted'; path: string }
  | { outcome: 'deleted'; path: string };

async function readSnapshot(workspacePath: string, toolCallId: string): Promise<EditSnapshot | null> {
  try {
    const raw = await fs.promises.readFile(snapshotFile(workspacePath, toolCallId), 'utf-8');
    return JSON.parse(raw) as EditSnapshot;
  } catch {
    return null;
  }
}

async function currentHash(absolutePath: string): Promise<string> {
  try {
    return hash(await fs.promises.readFile(absolutePath, 'utf-8'));
  } catch {
    return '';
  }
}

/**
 * Puts a file back the way it was before an agent edit. Without force, refuses when the
 * file no longer matches what the edit produced, since something else has changed it since.
 */
export async function revertEdit(workspacePath: string, toolCallId: string, force: boolean): Promise<RevertResult> {
  const snapshot = await readSnapshot(workspacePath, toolCallId);
  if (!snapshot) return { outcome: 'not-found' };

  validatePath(snapshot.path, workspacePath);
  if (!force && await currentHash(snapshot.path) !== snapshot.afterHash) {
    return { outcome: 'stale', path: snapshot.path };
  }

  if (snapshot.existed) {
    await writeFileContent(snapshot.path, snapshot.before, workspacePath);
  } else {
    await fs.promises.rm(snapshot.path, { force: true });
  }
  await fs.promises.rm(snapshotFile(workspacePath, toolCallId), { force: true });
  return { outcome: snapshot.existed ? 'reverted' : 'deleted', path: snapshot.path };
}
