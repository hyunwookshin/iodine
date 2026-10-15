import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clearRootPath, rootPath, setRootPath } from '../src/state';

let workspacePath: string;
let previousRootPath: string | null;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  previousRootPath = rootPath;
  workspacePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'iodine-missing-path-'));
  setRootPath(workspacePath);
  server = createApp().listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await fs.promises.rm(workspacePath, { recursive: true, force: true });
  if (previousRootPath) setRootPath(previousRootPath);
  else clearRootPath();
});

describe('missing workspace paths', () => {
  it.each([
    ['/files/image', 'missing.png'],
    ['/files/pdf', 'missing.pdf'],
    ['/files', 'missing.txt'],
  ])('returns a JSON 404 for %s', async (route, filename) => {
    const url = `${baseUrl}${route}?path=${encodeURIComponent(path.join(workspacePath, filename))}`;
    const response = await fetch(url, { method: route === '/files' ? 'DELETE' : 'GET' });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'File not found' });
  });
});
