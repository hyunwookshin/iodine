import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { rootPath } from '../state';
import { loadApiKey } from '../services/anthropicAgent';
import { loadOpenAIKey } from '../services/openaiAgent';
import { loadGeminiKey } from '../services/geminiAgent';

const router = Router();

interface BuildConfig {
  test: string;
  build: string;
  run: string;
}

function iodineDir(workspaceRoot: string): string {
  const md5 = crypto.createHash('md5').update(workspaceRoot).digest('hex');
  return path.join(os.homedir(), '.iodine', md5);
}

function configFilePath(workspaceRoot: string): string {
  return path.join(iodineDir(workspaceRoot), 'build-config.json');
}

// Probe the workspace for project-type hints and return a human-readable summary.
function probeWorkspace(root: string): string {
  const lines: string[] = [];

  const checks: Array<[string, string]> = [
    ['package.json',    'Node.js/JavaScript/TypeScript project (package.json)'],
    ['Cargo.toml',      'Rust project (Cargo.toml)'],
    ['go.mod',          'Go project (go.mod)'],
    ['pyproject.toml',  'Python project (pyproject.toml)'],
    ['requirements.txt','Python project (requirements.txt)'],
    ['setup.py',        'Python project (setup.py)'],
    ['Makefile',        'Has Makefile'],
    ['CMakeLists.txt',  'C/C++ project (CMakeLists.txt)'],
    ['build.gradle',    'Gradle/Java project'],
    ['pom.xml',         'Maven/Java project'],
    ['Gemfile',         'Ruby project (Gemfile)'],
    ['mix.exs',         'Elixir project (mix.exs)'],
  ];

  for (const [file, desc] of checks) {
    if (!fs.existsSync(path.join(root, file))) continue;
    lines.push(desc);

    if (file === 'package.json') {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, file), 'utf-8'));
        const scripts = (pkg.scripts ?? {}) as Record<string, string>;
        const names = Object.keys(scripts);
        if (names.length) lines.push(`Available npm scripts: ${names.join(', ')}`);
        if (scripts.test)  lines.push(`test script: ${scripts.test}`);
        if (scripts.build) lines.push(`build script: ${scripts.build}`);
        if (scripts.start) lines.push(`start script: ${scripts.start}`);
        if (scripts.dev)   lines.push(`dev script: ${scripts.dev}`);
      } catch { /* ignore */ }
    }

    if (file === 'Makefile') {
      try {
        const content = fs.readFileSync(path.join(root, 'Makefile'), 'utf-8');
        const targets = content.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/gm);
        if (targets) lines.push(`Makefile targets: ${[...new Set(targets.map(t => t.slice(0, -1)))].join(', ')}`);
      } catch { /* ignore */ }
    }
  }

  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are a build configuration assistant. Given information about a software project, output a single shell command for the requested operation (test, build, or run/start).

Rules:
- Output ONLY the shell command — no explanation, no markdown formatting, no surrounding quotes
- The command must work when executed from the project root directory
- Prefer standard package manager commands (npm, cargo, go, etc.) when available
- For "run", prefer a dev/start command if available`;

function makeUserPrompt(type: 'test' | 'build' | 'run', projectInfo: string): string {
  const label = type === 'run' ? 'run/start' : type;
  return `Project information:\n${projectInfo || 'No specific project files detected.'}\n\nGenerate the ${label} command for this project.`;
}

// ── GET /api/build-config ───────────────────────────────────────────────────

router.get('/build-config', (_req, res) => {
  if (!rootPath) return res.json({ test: '', build: '', run: '' });
  try {
    const raw = fs.readFileSync(configFilePath(rootPath), 'utf-8');
    res.json(JSON.parse(raw) as BuildConfig);
  } catch {
    res.json({ test: '', build: '', run: '' });
  }
});

// ── PUT /api/build-config ───────────────────────────────────────────────────

router.put('/build-config', (req, res) => {
  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  const body = req.body as Partial<BuildConfig>;
  const config: BuildConfig = {
    test:  body.test  ?? '',
    build: body.build ?? '',
    run:   body.run   ?? '',
  };
  const dir = iodineDir(rootPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFilePath(rootPath), JSON.stringify(config, null, 2));
  res.json({ ok: true });
});

// ── POST /api/build-config/generate ────────────────────────────────────────

router.post('/build-config/generate', async (req, res) => {
  const { type, provider: providerId, model } = req.body as {
    type?: 'test' | 'build' | 'run';
    provider?: string;
    model?: string;
  };

  if (!rootPath) return res.status(400).json({ error: 'No workspace open' });
  if (!type) return res.status(400).json({ error: 'Missing type' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const abortSignal = { aborted: false };
  res.on('close', () => { abortSignal.aborted = true; });

  const projectInfo     = probeWorkspace(rootPath);
  const selectedProvider = providerId || 'anthropic';
  const selectedModel   = model || 'claude-sonnet-4-6';
  const userMsg         = makeUserPrompt(type, projectInfo);

  const push = (text: string) => {
    if (!abortSignal.aborted) res.write(`event: text_delta\ndata: ${JSON.stringify({ text })}\n\n`);
  };

  try {
    if (selectedProvider === 'openai') {
      const apiKey = await loadOpenAIKey();
      const client = new OpenAI({ apiKey });
      const stream = await client.chat.completions.create({
        model: selectedModel,
        max_tokens: 128,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMsg },
        ],
        stream: true,
      });
      for await (const chunk of stream) {
        if (abortSignal.aborted) break;
        const text = chunk.choices[0]?.delta?.content ?? '';
        if (text) push(text);
      }

    } else if (selectedProvider === 'google') {
      const apiKey = await loadGeminiKey();
      const ai = new GoogleGenAI({ apiKey });
      const stream = await ai.models.generateContentStream({
        model: selectedModel,
        contents: [{ role: 'user', parts: [{ text: userMsg }] }],
        config: { systemInstruction: SYSTEM_PROMPT },
      });
      for await (const chunk of stream) {
        if (abortSignal.aborted) break;
        for (const part of (chunk.candidates?.[0]?.content?.parts ?? [])) {
          if (typeof part.text === 'string' && part.text) push(part.text);
        }
      }

    } else {
      // Anthropic (default)
      const apiKey = await loadApiKey();
      const client = new Anthropic({ apiKey });
      const stream = client.messages.stream({
        model: selectedModel,
        max_tokens: 128,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      });
      for await (const event of stream) {
        if (abortSignal.aborted) break;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          push(event.delta.text);
        }
      }
    }

    if (!abortSignal.aborted) res.write(`event: done\ndata: {}\n\n`);
  } catch (err: unknown) {
    if (!abortSignal.aborted) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
    }
  } finally {
    if (!abortSignal.aborted) res.end();
  }
});

export default router;
