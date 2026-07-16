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

// ── System graph generation (agentic — reads the actual workspace) ────────────

router.post('/system-graph/generate', async (req, res) => {
  const { model, provider: providerId } = req.body as {
    model?: string; provider?: string;
  };

  if (!rootPath) return res.status(400).json({ error: 'No workspace is open' });

  const selectedModel    = model      || 'claude-sonnet-4-6';
  const selectedProvider = providerId || 'anthropic';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const abortSignal = { aborted: false };
  res.on('close', () => { abortSignal.aborted = true; });

  const graphSystemPrompt = `You are a system architecture diagram generator with access to the user's project files.
Workspace: ${rootPath}

Your task:
1. Use list_directory and read_file tools to explore the workspace and understand the system architecture.
2. Read key files: package.json, README, main entry points, config files, and service or module definitions.
3. Based on what you find, generate a system architecture graph.

When you have finished exploring, your ENTIRE response must be a single raw JSON object and nothing else. Do not write any explanation, greeting, summary, or markdown fences before or after it. The very first character of your response must be { and the very last must be }.

JSON schema (do not include x/y coordinates):
{
  "nodes": [
    { "id": "lowercase-id", "name": "Display Name", "subname": "optional subtitle", "color": "#rrggbb" }
  ],
  "edges": [
    { "source": "node-id", "target": "node-id", "type": "directed|bidirectional|undirected", "label": "optional" }
  ]
}

Edge types:
  directed      — arrow pointing at the target (A calls B)
  bidirectional — arrows at both ends (A and B communicate)
  undirected    — dashed line, no arrows (association)

Color guidance: use dark hex colors for white text:
  #1e4e6e (blue, services)   #3e1e6e (purple, gateways)
  #1e5e2e (green, clients)   #5e2e2e (red, databases)
  #4e3e1e (brown, queues)    #1e3e5e (navy, external)

Keep node ids short and URL-safe (e.g. "api", "auth-svc", "pg-db").`;

  const initMessage = 'Explore the workspace and generate a system architecture graph in JSON.';

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
