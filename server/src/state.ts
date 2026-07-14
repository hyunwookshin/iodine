import fs from 'fs';
import path from 'path';
import os from 'os';

const PERSIST_FILE = path.join(os.homedir(), '.iodine', 'workspace');

function loadPersistedPath(): string | null {
  try {
    const saved = fs.readFileSync(PERSIST_FILE, 'utf-8').trim();
    if (saved && fs.existsSync(saved)) return saved;
  } catch {
    // no persisted workspace
  }
  return null;
}

export let rootPath: string | null = loadPersistedPath();

export function setRootPath(p: string) {
  rootPath = p;
  try {
    fs.mkdirSync(path.dirname(PERSIST_FILE), { recursive: true });
    fs.writeFileSync(PERSIST_FILE, p, 'utf-8');
  } catch {
    // ignore write errors
  }
}

export function clearRootPath() {
  rootPath = null;
  try {
    fs.unlinkSync(PERSIST_FILE);
  } catch {
    // ignore — file may not exist
  }
}
