import { Router } from 'express';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { loadApiKey, runAgentLoop } from '../services/anthropicAgent';
import { loadOpenAIKey, runOpenAIAgentLoop } from '../services/openaiAgent';
import { loadGeminiKey, runGeminiAgentLoop } from '../services/geminiAgent';
import { architectureGraphInitMessage, architectureGraphSystemPrompt } from '../prompts/architectureGraph';
import { revertEdit } from '../services/editSnapshots';
import { rootPath } from '../state';
import Anthropic from '@anthropic-ai/sdk';

const GRAPH_FILE_LIMIT = 160;
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv']);

function countFiles(dir: string): number {
  let count = 0;
  const queue = [dir];
  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) queue.push(join(current, entry.name));
      } else {
        count++;
        if (count > GRAPH_FILE_LIMIT) return count;
      }
    }
  }
  return count;
}

const router = Router();

router.get('/agent/status', async (_req, res) => {
  const [anthropicOk, openaiOk, geminiOk] = await Promise.all([
    loadApiKey().then(() => true).catch(() => false),
    loadOpenAIKey().then(() => true).catch(() => false),
    loadGeminiKey().then(() => true).catch(() => false),
  ]);
  res.json({ configured: anthropicOk, providers: { anthropic: anthropicOk, openai: openaiOk, google: geminiOk }, workspace: rootPath });
});

router.post('/agent/revert', async (req, res) => {
  const { toolCallId, force } = req.body as { toolCallId?: string; force?: boolean };
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  if (!toolCallId) return res.status(400).json({ error: 'toolCallId is required' });

  try {
    const result = await revertEdit(rootPath, toolCallId, force === true);
    if (result.outcome === 'not-found') return res.status(404).json({ error: 'No snapshot for this edit' });
    return res.json(result);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Revert failed' });
  }
});

router.post('/agent/chat', async (req, res) => {
  const { messages, model, provider, activeFile, tutorMode } = req.body as {
    messages?: { role: 'user' | 'assistant'; content: string }[];
    model?: string;
    provider?: string;
    activeFile?: string | null;
    tutorMode?: boolean;
  };

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const selectedModel = model || 'claude-sonnet-4-6';
  const selectedProvider = provider || 'anthropic';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const abortSignal = { aborted: false };
  res.on('close', () => { abortSignal.aborted = true; });

  // Send an SSE comment every 15 s so the TCP connection stays alive during
  // silent periods (e.g. while the agent is executing a file-write tool call).
  const heartbeat = setInterval(() => {
    if (!abortSignal.aborted) res.write(': heartbeat\n\n');
  }, 15_000);

  try {
    if (selectedProvider === 'openai') {
      await runOpenAIAgentLoop(messages, selectedModel, res, abortSignal, activeFile ?? null, undefined, tutorMode);
    } else if (selectedProvider === 'google') {
      await runGeminiAgentLoop(messages, selectedModel, res, abortSignal, activeFile ?? null, undefined, tutorMode);
    } else {
      const history: Anthropic.MessageParam[] = messages.map(m => ({ role: m.role, content: m.content }));
      await runAgentLoop(history, selectedModel, res, abortSignal, activeFile ?? null, undefined, tutorMode);
    }
  } catch (err: unknown) {
    if (!abortSignal.aborted) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
    }
  } finally {
    clearInterval(heartbeat);
    if (!abortSignal.aborted) res.end();
  }
});

// ── System graph generation (agentic — reads the actual workspace) ────────────

router.post('/system-graph/generate', async (req, res) => {
  const { model, provider: providerId } = req.body as {
    model?: string; provider?: string;
  };

  if (!rootPath) return res.status(400).json({ error: 'No workspace is open' });

  const fileCount = countFiles(rootPath);
  if (fileCount > GRAPH_FILE_LIMIT) {
    return res.status(400).json({ error: `Workspace has too many files (${fileCount}+) for graph generation. Limit is ${GRAPH_FILE_LIMIT}.` });
  }

  const selectedModel    = model      || 'claude-sonnet-4-6';
  const selectedProvider = providerId || 'anthropic';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const abortSignal = { aborted: false };
  res.on('close', () => { abortSignal.aborted = true; });

  const graphSystemPrompt = architectureGraphSystemPrompt(rootPath);
  const initMessage = architectureGraphInitMessage;

  try {
    if (selectedProvider === 'openai') {
      await runOpenAIAgentLoop(
        [{ role: 'user', content: initMessage }],
        selectedModel, res, abortSignal, null, graphSystemPrompt,
      );
    } else if (selectedProvider === 'google') {
      await runGeminiAgentLoop(
        [{ role: 'user', content: initMessage }],
        selectedModel, res, abortSignal, null, graphSystemPrompt,
      );
    } else {
      const history: Anthropic.MessageParam[] = [{ role: 'user', content: initMessage }];
      await runAgentLoop(history, selectedModel, res, abortSignal, null, graphSystemPrompt);
    }
  } catch (err: unknown) {
    if (!abortSignal.aborted) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
    }
  } finally {
    if (!abortSignal.aborted) res.end();
  }
});

export default router;
