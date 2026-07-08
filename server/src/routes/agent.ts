import { Router } from 'express';
import { loadApiKey, runAgentLoop } from '../services/anthropicAgent';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

router.get('/agent/status', async (_req, res) => {
  try {
    await loadApiKey();
    res.json({ configured: true });
  } catch {
    res.json({ configured: false });
  }
});

router.post('/agent/chat', async (req, res) => {
  const { messages, model } = req.body as {
    messages?: { role: 'user' | 'assistant'; content: string }[];
    model?: string;
  };

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const selectedModel = model || 'claude-sonnet-4-6';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const abortSignal = { aborted: false };
  // Use res.on('close'), NOT req.on('close').
  // req is an IncomingMessage (Readable). Express's JSON parser consumes the POST body
  // immediately, which destroys the req stream and fires req's 'close' event — long
  // before the client actually closes the SSE connection. res.on('close') fires only
  // when the response channel is genuinely torn down (client navigates away, etc.).
  res.on('close', () => { abortSignal.aborted = true; });

  try {
    const history: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    await runAgentLoop(history, selectedModel, res, abortSignal);
  } catch (err: unknown) {
    if (!abortSignal.aborted) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
    }
  } finally {
    if (!abortSignal.aborted) {
      res.end();
    }
  }
});

export default router;
