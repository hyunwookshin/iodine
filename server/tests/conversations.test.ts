import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationsRouter } from '../src/routes/conversations';

const workspaces = {
  a: 'C:/workspace/a',
  b: 'C:/workspace/b',
};

function createTestApp(cacheRoot: string) {
  const app = express();
  app.use(express.json());
  app.use('/api', createConversationsRouter({ cacheRoot }));
  return app;
}

function uiMessages(text: string) {
  return [
    { id: 'message-1', role: 'user', content: text, timestamp: 1 },
    { id: 'message-2', role: 'assistant', blocks: [{ type: 'text', content: 'answer' }], isStreaming: false, timestamp: 2 },
  ];
}

function record(id: string, timestamp: number, text = id) {
  return {
    id,
    timestamp,
    history: [{ role: 'user' as const, content: text }, { role: 'assistant' as const, content: 'answer' }],
    uiMessages: uiMessages(text),
  };
}

const tempRoots: string[] = [];

function newRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iodine-conversations-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempRoots.length) fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
});

describe('conversation routes', () => {
  it('creates, overwrites, and lists the three newest records', async () => {
    const app = createTestApp(newRoot());
    for (const item of [record('old', 1), record('middle', 2), record('new', 3), record('newest', 4)]) {
      await request(app).post('/api/conversations').send({ workspacePath: workspaces.a, ...item }).expect(200);
    }

    await request(app)
      .post('/api/conversations')
      .send({ workspacePath: workspaces.a, ...record('middle', 5, 'updated') })
      .expect(200);

    const response = await request(app).get('/api/conversations').query({ workspacePath: workspaces.a }).expect(200);
    expect(response.body.map((item: { id: string }) => item.id)).toEqual(['middle', 'newest', 'new']);
    expect(response.body.find((item: { id: string }) => item.id === 'middle').history[0].content).toBe('updated');
  });

  it('isolates workspaces and clears only the selected workspace', async () => {
    const app = createTestApp(newRoot());
    await request(app).post('/api/conversations').send({ workspacePath: workspaces.a, ...record('a', 1) }).expect(200);
    await request(app).post('/api/conversations').send({ workspacePath: workspaces.b, ...record('b', 1) }).expect(200);

    await request(app).delete('/api/conversations').query({ workspacePath: workspaces.a }).expect(200);
    expect((await request(app).get('/api/conversations').query({ workspacePath: workspaces.a })).body).toEqual([]);
    expect((await request(app).get('/api/conversations').query({ workspacePath: workspaces.b })).body).toHaveLength(1);
  });

  it('rejects invalid IDs and malformed records', async () => {
    const app = createTestApp(newRoot());
    await request(app).post('/api/conversations').send({ workspacePath: workspaces.a, ...record('../escape', 1) }).expect(400);
    await request(app).post('/api/conversations').send({ workspacePath: workspaces.a, ...record('bad', 1), history: [{ role: 'system', content: 'not allowed' }] }).expect(400);
    await request(app).post('/api/conversations').send({ workspacePath: workspaces.a, ...record('bad-ui', 1), uiMessages: [{ role: 'assistant' }] }).expect(400);
  });

  it('skips malformed files while retaining valid files', async () => {
    const root = newRoot();
    const app = createTestApp(root);
    await request(app).post('/api/conversations').send({ workspacePath: workspaces.a, ...record('valid', 1) }).expect(200);
    const hash = (await import('crypto')).createHash('md5').update(workspaces.a).digest('hex');
    fs.writeFileSync(path.join(root, hash, 'conversations', 'broken.json'), '{not json');

    const response = await request(app).get('/api/conversations').query({ workspacePath: workspaces.a }).expect(200);
    expect(response.body.map((item: { id: string }) => item.id)).toEqual(['valid']);
  });

  it('returns a structured error and preserves the prior record when replacement fails', async () => {
    const app = createTestApp(newRoot());
    await request(app).post('/api/conversations').send({ workspacePath: workspaces.a, ...record('same', 1, 'before') }).expect(200);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('rename failed'); });

    const failed = await request(app).post('/api/conversations').send({ workspacePath: workspaces.a, ...record('same', 2, 'after') }).expect(500);
    expect(failed.body).toEqual({ error: 'rename failed' });
    const current = await request(app).get('/api/conversations').query({ workspacePath: workspaces.a }).expect(200);
    expect(current.body[0].history[0].content).toBe('before');
  });

  it('handles absent directories and missing required delete scope', async () => {
    const app = createTestApp(newRoot());
    expect((await request(app).get('/api/conversations').query({ workspacePath: workspaces.a })).body).toEqual([]);
    await request(app).delete('/api/conversations').expect(400);
  });
});
