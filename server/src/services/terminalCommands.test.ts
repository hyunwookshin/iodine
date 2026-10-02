import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { clearRootPath, rootPath, setRootPath } from '../state';
import { findMatch, loadRules, saveRule } from './commandApproval/rules';
import { describeCommand } from './commandApproval/signature';
import { requestTerminalApproval, resolveTerminalApproval } from './terminalCommands';

vi.mock('./commandApproval/embeddings', async importOriginal => {
  const original = await importOriginal<typeof import('./commandApproval/embeddings')>();
  return { ...original, embedCommand: vi.fn().mockResolvedValue([0.99, 0.1]) };
});

let workspace: string;
const originalRootPath = rootPath;

beforeAll(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iodine-approval-flow-')));
  fs.mkdirSync(path.join(workspace, 'src'));
  fs.mkdirSync(path.join(workspace, 'other'));
  setRootPath(workspace);
});

afterAll(() => {
  if (originalRootPath) setRootPath(originalRootPath);
  else clearRootPath();
  const hash = crypto.createHash('md5').update(workspace).digest('hex');
  fs.rmSync(path.join(os.homedir(), '.iodine', hash), { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('similar approval flow', () => {
  it('saves the directory scope only when the user selects it', async () => {
    const writes: string[] = [];
    const response = { write: (chunk: string) => writes.push(chunk) } as unknown as Response;
    const approval = requestTerminalApproval(
      { id: 'directory-scope', command: 'mkdir src/new', reason: 'create folder', longRunning: false },
      response,
      { aborted: false },
    );
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toContain('directoryLabel');
    await resolveTerminalApproval('directory-scope', true, true, 'directory');
    expect(await approval).toBe(true);
    expect((await loadRules(workspace)).at(-1)?.pathScopes).toEqual([
      { path: path.join(workspace, 'src/new'), descendants: true },
    ]);
    await vi.waitFor(async () => {
      expect((await loadRules(workspace)).at(-1)?.embedding).toEqual([0.99, 0.1]);
    });
    const logPath = path.join(os.homedir(), '.iodine', crypto.createHash('md5').update(workspace).digest('hex'), 'approval-log.jsonl');
    const decisions = fs.readFileSync(logPath, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
    expect(decisions).toContainEqual(expect.objectContaining({ event: 'manual-decision', approved: true, savedScope: 'directory' }));
    expect(decisions.at(-1).normalized[0]).toContain('mkdir ');
    const child = describeCommand('mkdir src/new/child', workspace, workspace);
    if (!child.ok) throw new Error(child.reason);
    expect(await findMatch(workspace, child.parts)).toHaveLength(1);
    const originalAutoApprove = process.env.IODINE_AUTO_APPROVE;
    delete process.env.IODINE_AUTO_APPROVE;
    try {
      const childWrites: string[] = [];
      const childResponse = { write: (chunk: string) => childWrites.push(chunk) } as unknown as Response;
      expect(await requestTerminalApproval(
        { id: 'directory-child', command: 'mkdir src/new/child', reason: 'create child', longRunning: false },
        childResponse,
        { aborted: false },
      )).toBe(true);
      expect(childWrites[0]).toContain('autoApproved');
    } finally {
      if (originalAutoApprove === undefined) delete process.env.IODINE_AUTO_APPROVE;
      else process.env.IODINE_AUTO_APPROVE = originalAutoApprove;
    }
  });

  it('suggests a saved rule but still asks the user', async () => {
    const described = describeCommand('ls src', workspace, workspace);
    if (!described.ok) throw new Error(described.reason);
    await saveRule(workspace, described.parts[0], [1, 0]);

    const originalKey = process.env.OPENAI_TOKEN;
    const originalAutoApprove = process.env.IODINE_AUTO_APPROVE;
    delete process.env.OPENAI_TOKEN;
    process.env.IODINE_AUTO_APPROVE = '1';
    try {
      const writes: string[] = [];
      const response = { write: (chunk: string) => writes.push(chunk) } as unknown as Response;
      const approval = requestTerminalApproval(
        { id: 'similar-command', command: 'ls other', reason: 'inspect files', longRunning: false },
        response,
        { aborted: false },
      );

      await vi.waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toContain('similarRuleLabel');
      expect(writes[0]).not.toContain('autoApproved');
      await resolveTerminalApproval('similar-command', false);
      expect(await approval).toBe(false);
    } finally {
      if (originalKey === undefined) delete process.env.OPENAI_TOKEN;
      else process.env.OPENAI_TOKEN = originalKey;
      if (originalAutoApprove === undefined) delete process.env.IODINE_AUTO_APPROVE;
      else process.env.IODINE_AUTO_APPROVE = originalAutoApprove;
    }
  });

  it('automatically applies a newly saved rule without a rollout flag', async () => {
    const described = describeCommand('ls src', workspace, workspace);
    if (!described.ok) throw new Error(described.reason);
    await saveRule(workspace, described.parts[0]);

    const originalAutoApprove = process.env.IODINE_AUTO_APPROVE;
    delete process.env.IODINE_AUTO_APPROVE;
    try {
      const writes: string[] = [];
      const response = { write: (chunk: string) => writes.push(chunk) } as unknown as Response;
      const approved = await requestTerminalApproval(
        { id: 'exact-command', command: 'ls src', reason: 'inspect files', longRunning: false },
        response,
        { aborted: false },
      );
      expect(approved).toBe(true);
      expect(writes[0]).toContain('autoApproved');
    } finally {
      if (originalAutoApprove === undefined) delete process.env.IODINE_AUTO_APPROVE;
      else process.env.IODINE_AUTO_APPROVE = originalAutoApprove;
    }
  });

  it('keeps older rules in review mode by default', async () => {
    const described = describeCommand('ls other', workspace, workspace);
    if (!described.ok) throw new Error(described.reason);
    await saveRule(workspace, described.parts[0]);
    const hash = crypto.createHash('md5').update(workspace).digest('hex');
    const file = path.join(os.homedir(), '.iodine', hash, 'approval-rules.json');
    const rules = JSON.parse(fs.readFileSync(file, 'utf-8'));
    delete rules.at(-1).autoApply;
    fs.writeFileSync(file, JSON.stringify(rules));

    const originalAutoApprove = process.env.IODINE_AUTO_APPROVE;
    delete process.env.IODINE_AUTO_APPROVE;
    try {
      const writes: string[] = [];
      const response = { write: (chunk: string) => writes.push(chunk) } as unknown as Response;
      const approval = requestTerminalApproval(
        { id: 'legacy-command', command: 'ls other', reason: 'inspect files', longRunning: false },
        response,
        { aborted: false },
      );
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).not.toContain('autoApproved');
      await resolveTerminalApproval('legacy-command', false);
      expect(await approval).toBe(false);
    } finally {
      if (originalAutoApprove === undefined) delete process.env.IODINE_AUTO_APPROVE;
      else process.env.IODINE_AUTO_APPROVE = originalAutoApprove;
    }
  });
});
