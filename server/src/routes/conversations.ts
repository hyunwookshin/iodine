import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface ConversationRecord {
  id: string;
  timestamp: number;
  history: { role: 'user' | 'assistant'; content: string }[];
  uiMessages: unknown[];
}

interface ConversationRouterOptions {
  /** Override the ~/.iodine directory for isolated route tests. */
  cacheRoot?: string;
}

const MAX_ID_LENGTH = 128;
const MAX_CONVERSATIONS_SHOWN = 6;
const MAX_MESSAGES = 10_000;
const MAX_CONTENT_LENGTH = 1_000_000;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ID_LENGTH
    && ID_PATTERN.test(value);
}

function isValidHistory(value: unknown): value is ConversationRecord['history'] {
  return Array.isArray(value)
    && value.length <= MAX_MESSAGES
    && value.every(message => isObject(message)
      && (message.role === 'user' || message.role === 'assistant')
      && typeof message.content === 'string'
      && message.content.length <= MAX_CONTENT_LENGTH);
}

function isValidUiBlock(value: unknown): boolean {
  if (!isObject(value) || typeof value.type !== 'string') return false;
  if (value.type === 'text' || value.type === 'thought') {
    return typeof value.content === 'string' && value.content.length <= MAX_CONTENT_LENGTH;
  }
  if (value.type === 'tool') {
    return typeof value.id === 'string'
      && typeof value.name === 'string'
      && isObject(value.input)
      && typeof value.pending === 'boolean';
  }
  if (value.type === 'command-approval') {
    return typeof value.id === 'string'
      && typeof value.command === 'string'
      && typeof value.reason === 'string'
      && (typeof value.cwd === 'string' || value.cwd === null)
      && typeof value.longRunning === 'boolean'
      && (value.status === 'pending' || value.status === 'approved' || value.status === 'rejected')
      && typeof value.output === 'string'
      && value.output.length <= MAX_CONTENT_LENGTH;
  }
  if (value.type === 'plan') {
    const planSteps = Array.isArray(value.steps) ? value.steps : [];
    return typeof value.id === 'string'
      && typeof value.title === 'string'
      && (value.status === 'proposed' || value.status === 'approved' || value.status === 'executing'
        || value.status === 'paused' || value.status === 'completed')
      && (value.executionMode === undefined || value.executionMode === 'auto' || value.executionMode === 'manual')
      && planSteps.length <= MAX_MESSAGES
      && planSteps.every(step => isObject(step)
        && typeof step.text === 'string'
        && step.text.length <= MAX_CONTENT_LENGTH
        && typeof step.done === 'boolean'
        && (step.summary === undefined || typeof step.summary === 'string'));
  }
  if (value.type === 'edit-approval') {
    return typeof value.id === 'string'
      && (value.op === 'edit' || value.op === 'write')
      && typeof value.path === 'string'
      && typeof value.preview === 'string'
      && value.preview.length <= MAX_CONTENT_LENGTH
      && (value.status === 'pending' || value.status === 'approved' || value.status === 'rejected');
  }
  return false;
}

function isValidUiMessage(value: unknown): boolean {
  if (!isObject(value) || (value.role !== 'user' && value.role !== 'assistant')) return false;
  if (typeof value.id !== 'string' || typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return false;
  if (value.role === 'user') return typeof value.content === 'string';
  return Array.isArray(value.blocks) && value.blocks.every(isValidUiBlock) && typeof value.isStreaming === 'boolean';
}

function isValidUiMessages(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= MAX_MESSAGES && value.every(isValidUiMessage);
}

function parseRecord(value: unknown): ConversationRecord | null {
  if (!isObject(value)
    || !isValidId(value.id)
    || typeof value.timestamp !== 'number'
    || !Number.isFinite(value.timestamp)
    || !isValidHistory(value.history)
    || !isValidUiMessages(value.uiMessages)) {
    return null;
  }
  return {
    id: value.id,
    timestamp: value.timestamp,
    history: value.history,
    uiMessages: value.uiMessages,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Conversation storage failed';
}

export function createConversationsRouter(options: ConversationRouterOptions = {}) {
  const router = Router();
  const cacheRoot = options.cacheRoot ?? path.join(os.homedir(), '.iodine');

  function conversationsDir(workspacePath: string): string {
    const hash = crypto.createHash('md5').update(workspacePath).digest('hex');
    return path.join(cacheRoot, hash, 'conversations');
  }

  router.get('/conversations', (req, res) => {
    const workspacePath = typeof req.query.workspacePath === 'string' ? req.query.workspacePath : undefined;
    if (!workspacePath) return res.json([]);

    const dir = conversationsDir(workspacePath);
    try {
      const files = fs.readdirSync(dir).filter(file => file.endsWith('.json'));
      const records: ConversationRecord[] = [];
      for (const file of files) {
        try {
          const record = parseRecord(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')));
          if (record) records.push(record);
        } catch {
          // Ignore malformed or concurrently deleted files.
        }
      }
      records.sort((a, b) => b.timestamp - a.timestamp);
      return res.json(records.slice(0, MAX_CONVERSATIONS_SHOWN));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return res.json([]);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.post('/conversations', (req, res) => {
    const body = isObject(req.body) ? req.body : {};
    const workspacePath = typeof body.workspacePath === 'string' ? body.workspacePath : '';
    const id = body.id;
    const timestamp = body.timestamp ?? Date.now();
    const history = body.history ?? [];
    const uiMessages = body.uiMessages ?? [];

    if (!workspacePath || !isValidId(id) || typeof timestamp !== 'number' || !Number.isFinite(timestamp)
      || !isValidHistory(history) || !isValidUiMessages(uiMessages)) {
      return res.status(400).json({ error: 'workspacePath, valid id, timestamp, history, and uiMessages are required' });
    }

    const dir = conversationsDir(workspacePath);
    const target = path.join(dir, `${id}.json`);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const record: ConversationRecord = { id, timestamp, history, uiMessages };

    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(record, null, 2), 'utf-8');
      fs.renameSync(temp, target);
      return res.json({ ok: true });
    } catch (error) {
      try { fs.unlinkSync(temp); } catch { /* best effort cleanup */ }
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.delete('/conversations', (req, res) => {
    const workspacePath = typeof req.query.workspacePath === 'string' ? req.query.workspacePath : undefined;
    if (!workspacePath) return res.status(400).json({ error: 'workspacePath is required' });

    const dir = conversationsDir(workspacePath);
    try {
      const files = fs.readdirSync(dir).filter(file => file.endsWith('.json'));
      for (const file of files) fs.unlinkSync(path.join(dir, file));
      return res.json({ ok: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return res.json({ ok: true });
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  return router;
}

export default createConversationsRouter();
