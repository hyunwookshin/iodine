import { Router } from 'express';
import { loadApiKey, runAgentLoop } from '../services/anthropicAgent';
import { loadOpenAIKey, runOpenAIAgentLoop } from '../services/openaiAgent';
import { loadGeminiKey, runGeminiAgentLoop } from '../services/geminiAgent';
import { rootPath } from '../state';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

router.get('/agent/status', async (_req, res) => {
  const [anthropicOk, openaiOk, geminiOk] = await Promise.all([
    loadApiKey().then(() => true).catch(() => false),
    loadOpenAIKey().then(() => true).catch(() => false),
    loadGeminiKey().then(() => true).catch(() => false),
  ]);
  res.json({ configured: anthropicOk, providers: { anthropic: anthropicOk, openai: openaiOk, google: geminiOk }, workspace: rootPath });
});

router.post('/agent/chat', async (req, res) => {
  const { messages, model, provider, activeFile } = req.body as {
    messages?: { role: 'user' | 'assistant'; content: string }[];
    model?: string;
    provider?: string;
    activeFile?: string | null;
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

  try {
    if (selectedProvider === 'openai') {
      await runOpenAIAgentLoop(messages, selectedModel, res, abortSignal, activeFile ?? null);
    } else if (selectedProvider === 'google') {
      await runGeminiAgentLoop(messages, selectedModel, res, abortSignal, activeFile ?? null);
    } else {
      const history: Anthropic.MessageParam[] = messages.map(m => ({ role: m.role, content: m.content }));
      await runAgentLoop(history, selectedModel, res, abortSignal, activeFile ?? null);
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
