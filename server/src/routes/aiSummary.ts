import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { rootPath } from '../state';
import { validatePath } from '../services/fileSystem';
import { loadApiKey } from '../services/anthropicAgent';
import { loadOpenAIKey } from '../services/openaiAgent';
import { loadGeminiKey } from '../services/geminiAgent';
import { SUMMARY_SYSTEM_PROMPT } from '../prompts/summarySystem';
import { DIRECTORY_SUMMARY_SYSTEM_PROMPT } from '../prompts/directorySummarySystem';

const router = Router();

// ── Cache helpers ──────────────────────────────────────────────────────────────

function summaryDir(workspaceRoot: string, relPath: string): string {
  const wh = crypto.createHash('md5').update(workspaceRoot).digest('hex');
  const ph = crypto.createHash('md5').update(relPath).digest('hex');
  return path.join(os.homedir(), '.iodine', wh, ph);
}

function summaryFilePath(dir: string, contentHash: string): string {
  return path.join(dir, `${contentHash}_ai_summary.md`);
}

// ── GET /api/ai-summary — check cache ─────────────────────────────────────────

router.get('/ai-summary', async (req, res) => {
  const relPath        = req.query.path as string;
  const overrideWs     = req.query.workspacePath as string | undefined;
  const effectiveRoot  = overrideWs || rootPath;
  if (!relPath || !effectiveRoot) return res.json({ content: null });

  const absPath = path.join(effectiveRoot, relPath);
  let fileContent: string;
  try {
    validatePath(absPath, effectiveRoot);
    fileContent = await fs.promises.readFile(absPath, 'utf-8');
  } catch (err: unknown) {
    // OUTSIDE_ROOT from validatePath → treat as cache miss, not a traversal vector
    return res.json({ content: null });
  }

  const dir         = summaryDir(effectiveRoot, relPath);
  const contentHash = crypto.createHash('md5').update(fileContent).digest('hex');
  const sfp         = summaryFilePath(dir, contentHash);

  try {
    const cached = await fs.promises.readFile(sfp, 'utf-8');
    return res.json({ content: cached });
  } catch { /* exact hash miss — fall through to latest symlink */ }

  // Check the "latest" symlink for an obsolete (but existing) summary
  const latestLink = path.join(dir, 'latest_ai_summary.md');
  try {
    const cached = await fs.promises.readFile(latestLink, 'utf-8');
    return res.json({ content: cached, obsolete: true });
  } catch {
    return res.json({ content: null });
  }
});

// ── POST /api/ai-summary/generate — generate, stream, cache ───────────────────

router.post('/ai-summary/generate', async (req, res) => {
  const { filePath, provider: providerId, model, workspacePath: overrideWs } = req.body as {
    filePath?: string;
    provider?: string;
    model?: string;
    workspacePath?: string;
  };

  const effectiveRoot = overrideWs || rootPath;
  if (!effectiveRoot || !filePath) {
    return res.status(400).json({ error: 'Missing workspace or filePath' });
  }

  const absPath = path.join(effectiveRoot, filePath);
  let fileContent: string;
  try {
    validatePath(absPath, effectiveRoot);
    fileContent = await fs.promises.readFile(absPath, 'utf-8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'OUTSIDE_ROOT') return res.status(403).json({ error: 'Path outside workspace' });
    return res.status(404).json({ error: 'File not found' });
  }

  // Truncate very large files to avoid context-limit errors
  const MAX_CHARS = 80_000;
  const fileExcerpt = fileContent.length > MAX_CHARS
    ? fileContent.slice(0, MAX_CHARS) + '\n\n[... content truncated at 80 000 characters ...]'
    : fileContent;

  // Load system graph if present (only when there is a real workspace)
  const wh        = crypto.createHash('md5').update(effectiveRoot).digest('hex');
  const graphPath = path.join(os.homedir(), '.iodine', wh, 'system-graph.json');
  let graphText   = '';
  try { graphText = await fs.promises.readFile(graphPath, 'utf-8'); } catch { /* no graph */ }

  const selectedProvider = providerId || 'anthropic';
  const selectedModel    = model      || 'claude-sonnet-4-6';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const abortSignal = { aborted: false };
  res.on('close', () => { abortSignal.aborted = true; });

  const userMessage = [
    `File: ${filePath}`,
    '---',
    fileExcerpt,
    '---',
    graphText
      ? `System Architecture (JSON):\n${graphText}`
      : 'System Architecture: not available',
  ].join('\n');

  const contentHash = crypto.createHash('md5').update(fileContent).digest('hex');
  const dir         = summaryDir(effectiveRoot, filePath);
  const sfp         = summaryFilePath(dir, contentHash);

  let accumulated = '';
  const push = (text: string) => {
    accumulated += text;
    if (!abortSignal.aborted) res.write(`event: text_delta\ndata: ${JSON.stringify({ text })}\n\n`);
  };

  try {
    if (selectedProvider === 'openai') {
      const apiKey = await loadOpenAIKey();
      const client = new OpenAI({ apiKey });
      const stream = await client.chat.completions.create({
        model: selectedModel,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user',   content: userMessage },
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
      const ai     = new GoogleGenAI({ apiKey });
      const stream = await ai.models.generateContentStream({
        model: selectedModel,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: { systemInstruction: SUMMARY_SYSTEM_PROMPT },
      });
      for await (const chunk of stream) {
        if (abortSignal.aborted) break;
        for (const part of (chunk.candidates?.[0]?.content?.parts ?? [])) {
          if (part.text) push(part.text);
        }
      }

    } else {
      // Anthropic (default)
      const apiKey = await loadApiKey();
      const client = new Anthropic({ apiKey });
      const stream = client.messages.stream({
        model: selectedModel,
        max_tokens: 8192,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });
      for await (const event of stream) {
        if (abortSignal.aborted) break;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          push(event.delta.text);
        }
      }
    }

    // Persist to cache and update "latest" symlink
    if (!abortSignal.aborted && accumulated) {
      await fs.promises.mkdir(dir, { recursive: true });
      // Remove stale hash files before writing the new one
      try {
        const existing = await fs.promises.readdir(dir);
        await Promise.all(
          existing
            .filter(f => f.endsWith('_ai_summary.md') && f !== `${contentHash}_ai_summary.md`)
            .map(f => fs.promises.unlink(path.join(dir, f)).catch(() => {}))
        );
      } catch { /* dir may be empty or unreadable */ }
      await fs.promises.writeFile(sfp, accumulated, 'utf-8');
      // Update the "latest" pointer. Creating symlinks requires elevated rights or
      // Developer Mode on Windows (EPERM otherwise), so fall back to a plain copy
      // — the hash-named cache file above is already persisted either way.
      const latestLink = path.join(dir, 'latest_ai_summary.md');
      try {
        try { await fs.promises.unlink(latestLink); } catch { /* didn't exist */ }
        await fs.promises.symlink(`${contentHash}_ai_summary.md`, latestLink);
      } catch {
        try { await fs.promises.writeFile(latestLink, accumulated, 'utf-8'); } catch { /* non-fatal */ }
      }
    }

    if (!abortSignal.aborted) res.write(`event: done\ndata: {}\n\n`);

  } catch (err: unknown) {
    if (!abortSignal.aborted) {
      const msg = err instanceof Error ? err.message : 'Generation error';
      res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
    }
  } finally {
    if (!abortSignal.aborted) res.end();
  }
});

// ── Directory summary helpers ──────────────────────────────────────────────────

/** Walk a directory recursively and return all relative file paths (sorted). */
function walkDir(root: string, base: string = root): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // skip unreadable directories (e.g. permission denied)
  }
  const results: string[] = [];
  for (const entry of entries) {
    // Skip hidden dirs and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
    const absPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(absPath, base));
    } else {
      results.push(path.relative(base, absPath));
    }
  }
  return results.sort();
}

function dirContentsHash(files: string[]): string {
  return crypto.createHash('md5').update(files.join('\n')).digest('hex');
}

function dirSummaryDir(workspaceRoot: string, relPath: string): string {
  const wh = crypto.createHash('md5').update(workspaceRoot).digest('hex');
  const ph = crypto.createHash('md5').update(relPath).digest('hex');
  return path.join(os.homedir(), '.iodine', wh, ph);
}

function dirSummaryFilePath(dir: string, contentsHash: string): string {
  return path.join(dir, `${contentsHash}_ai_dir_summary.md`);
}

// ── GET /api/ai-directory-summary — check cache ────────────────────────────────

router.get('/ai-directory-summary', async (req, res) => {
  const relPath = req.query.path as string;
  if (!relPath || !rootPath) return res.json({ content: null });

  const absPath = path.join(rootPath, relPath);
  try {
    validatePath(absPath, rootPath);
    if (!fs.statSync(absPath).isDirectory()) return res.json({ content: null });
  } catch {
    return res.json({ content: null });
  }

  const files = walkDir(absPath);
  const contentsHash = dirContentsHash(files);
  const dir = dirSummaryDir(rootPath, relPath);
  const sfp = dirSummaryFilePath(dir, contentsHash);

  try {
    const cached = await fs.promises.readFile(sfp, 'utf-8');
    return res.json({ content: cached });
  } catch { /* exact hash miss — fall through to latest symlink */ }

  const latestLink = path.join(dir, 'latest_ai_dir_summary.md');
  try {
    const cached = await fs.promises.readFile(latestLink, 'utf-8');
    return res.json({ content: cached, obsolete: true });
  } catch {
    return res.json({ content: null });
  }
});

// ── POST /api/ai-directory-summary/generate — generate, stream, cache ─────────

router.post('/ai-directory-summary/generate', async (req, res) => {
  const { dirPath, provider: providerId, model } = req.body as {
    dirPath?: string;
    provider?: string;
    model?: string;
  };

  if (!rootPath || !dirPath) {
    return res.status(400).json({ error: 'Missing workspace or dirPath' });
  }

  const absPath = path.join(rootPath, dirPath);
  try {
    validatePath(absPath, rootPath);
    if (!fs.statSync(absPath).isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'OUTSIDE_ROOT') return res.status(403).json({ error: 'Path outside workspace' });
    return res.status(404).json({ error: 'Directory not found' });
  }

  const files = walkDir(absPath);
  const contentsHash = dirContentsHash(files);
  const dir = dirSummaryDir(rootPath, dirPath);
  const sfp = dirSummaryFilePath(dir, contentsHash);

  const selectedProvider = providerId || 'anthropic';
  const selectedModel    = model      || 'claude-sonnet-4-6';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const abortSignal = { aborted: false };
  res.on('close', () => { abortSignal.aborted = true; });

  const fileList = files.length > 0
    ? files.map(f => `  ${f}`).join('\n')
    : '  (empty directory)';

  const userMessage = `Directory: ${dirPath}\n\nFiles (${files.length} total):\n${fileList}`;

  let accumulated = '';
  const push = (text: string) => {
    accumulated += text;
    if (!abortSignal.aborted) res.write(`event: text_delta\ndata: ${JSON.stringify({ text })}\n\n`);
  };

  try {
    if (selectedProvider === 'openai') {
      const apiKey = await loadOpenAIKey();
      const client = new OpenAI({ apiKey });
      const stream = await client.chat.completions.create({
        model: selectedModel,
        messages: [
          { role: 'system', content: DIRECTORY_SUMMARY_SYSTEM_PROMPT },
          { role: 'user',   content: userMessage },
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
      const ai     = new GoogleGenAI({ apiKey });
      const stream = await ai.models.generateContentStream({
        model: selectedModel,
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        config: { systemInstruction: DIRECTORY_SUMMARY_SYSTEM_PROMPT },
      });
      for await (const chunk of stream) {
        if (abortSignal.aborted) break;
        for (const part of (chunk.candidates?.[0]?.content?.parts ?? [])) {
          if (part.text) push(part.text);
        }
      }

    } else {
      // Anthropic (default)
      const apiKey = await loadApiKey();
      const client = new Anthropic({ apiKey });
      const stream = client.messages.stream({
        model: selectedModel,
        max_tokens: 8192,
        system: DIRECTORY_SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });
      for await (const event of stream) {
        if (abortSignal.aborted) break;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          push(event.delta.text);
        }
      }
    }

    if (!abortSignal.aborted && accumulated) {
      await fs.promises.mkdir(dir, { recursive: true });
      try {
        const existing = await fs.promises.readdir(dir);
        await Promise.all(
          existing
            .filter(f => f.endsWith('_ai_dir_summary.md') && f !== `${contentsHash}_ai_dir_summary.md`)
            .map(f => fs.promises.unlink(path.join(dir, f)).catch(() => {}))
        );
      } catch { /* dir may be empty or unreadable */ }
      await fs.promises.writeFile(sfp, accumulated, 'utf-8');
      // Update the "latest" pointer. Creating symlinks requires elevated rights or
      // Developer Mode on Windows (EPERM otherwise), so fall back to a plain copy
      // — the hash-named cache file above is already persisted either way.
      const latestLink = path.join(dir, 'latest_ai_dir_summary.md');
      try {
        try { await fs.promises.unlink(latestLink); } catch { /* didn't exist */ }
        await fs.promises.symlink(`${contentsHash}_ai_dir_summary.md`, latestLink);
      } catch {
        try { await fs.promises.writeFile(latestLink, accumulated, 'utf-8'); } catch { /* non-fatal */ }
      }
    }

    if (!abortSignal.aborted) res.write(`event: done\ndata: {}\n\n`);

  } catch (err: unknown) {
    if (!abortSignal.aborted) {
      const msg = err instanceof Error ? err.message : 'Generation error';
      res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
    }
  } finally {
    if (!abortSignal.aborted) res.end();
  }
});

export default router;
