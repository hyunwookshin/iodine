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

// ── Cache helpers ──────────────────────────────────────────────────────────────

function summaryDir(workspaceRoot: string, relPath: string): string {
  const wh = crypto.createHash('md5').update(workspaceRoot).digest('hex');
  const ph = crypto.createHash('md5').update(relPath).digest('hex');
  return path.join(os.homedir(), '.iodine', wh, ph);
}

function summaryFilePath(dir: string, contentHash: string): string {
  return path.join(dir, `${contentHash}_ai_summary.md`);
}

// ── System prompt ──────────────────────────────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `You are a senior software engineer writing internal documentation for an engineering team.
You will receive a source file (with its path) and optionally a system architecture diagram in JSON.
Generate a comprehensive, tutorial-style document that teaches a mid-level engineer everything they need to know about this file.

## Format requirements

Use rich Markdown throughout — be liberal with formatting:
- \`# ## ###\` headers for clear sections
- **Bold** for key terms on first introduction
- *Italics* for emphasis or foreign terminology
- \`inline code\` for identifiers, method names, types, and literal values
- Fenced code blocks with the correct language tag for all code snippets
- Tables where comparative or structured data benefits from one
- Numbered lists for sequences/steps, bullet lists for enumerations
- ASCII diagrams in plain \`\`\`text blocks to visualise data flow, component relationships, call stacks, or state machines

## Content structure

Tailor the sections to what the file actually contains. Include the most relevant from:

### 1. Overview
What does this file do and what problem does it solve? One clear paragraph.

### 2. Technology Context *(if the file uses a notable framework or library)*
- Brief history of the technology (origin, creator, key milestones)
- 2–3 similar or competing alternatives with key trade-offs
- Why this technology is commonly chosen for this kind of problem

### 3. Architecture & Role
How does this file fit into the broader system? Reference the system architecture diagram if provided.
Include an ASCII diagram when the relationships are non-trivial, for example:

\`\`\`text
Browser  →  [This module]  →  Database
             ↑ validates
             Auth service
\`\`\`

### 4. API / Public Interface *(for files that export functions, classes, or HTTP routes)*
Open with one paragraph describing what the exports *collectively* accomplish.
Then document each export:

| Name | Signature | Purpose |
|------|-----------|---------|
| \`foo()\` | \`foo(x: number): string\` | Converts … |

Follow the table with a sub-section for each export covering parameters, return value, side effects, and a realistic short example.

### 5. Data Flow
Trace how data enters and exits this module. ASCII diagrams work well here:

\`\`\`text
HTTP request
  → parse & validate body
  → call service layer
  → transform result
  → HTTP response
\`\`\`

### 6. Key Patterns & Gotchas
Important implementation details, non-obvious behaviour, edge cases, performance considerations, or things that are easy to get wrong.

## Tone
Write as if *teaching*, not just describing. Explain the *why*, not only the *what*.
Use the second person ("you can…", "notice that…").
Do **not** mention or speculate about who uses this file, which team owns it, or any specific users.`;

// ── GET /api/ai-summary — check cache ─────────────────────────────────────────

router.get('/ai-summary', async (req, res) => {
  const relPath = req.query.path as string;
  if (!relPath || !rootPath) return res.json({ content: null });

  const absPath = path.join(rootPath, relPath);
  let fileContent: string;
  try {
    fileContent = await fs.promises.readFile(absPath, 'utf-8');
  } catch {
    return res.json({ content: null });
  }

  const dir         = summaryDir(rootPath, relPath);
  const contentHash = crypto.createHash('md5').update(fileContent).digest('hex');
  const sfp         = summaryFilePath(dir, contentHash);

  try {
    const cached = await fs.promises.readFile(sfp, 'utf-8');
    return res.json({ content: cached });
  } catch {
    return res.json({ content: null });
  }
});

// ── POST /api/ai-summary/generate — generate, stream, cache ───────────────────

router.post('/ai-summary/generate', async (req, res) => {
  const { filePath, provider: providerId, model } = req.body as {
    filePath?: string;
    provider?: string;
    model?: string;
  };

  if (!rootPath || !filePath) {
    return res.status(400).json({ error: 'Missing workspace or filePath' });
  }

  const absPath = path.join(rootPath, filePath);
  let fileContent: string;
  try {
    fileContent = await fs.promises.readFile(absPath, 'utf-8');
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }

  // Truncate very large files to avoid context-limit errors
  const MAX_CHARS = 80_000;
  const fileExcerpt = fileContent.length > MAX_CHARS
    ? fileContent.slice(0, MAX_CHARS) + '\n\n[... content truncated at 80 000 characters ...]'
    : fileContent;

  // Load system graph if present
  const wh        = crypto.createHash('md5').update(rootPath).digest('hex');
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
  const dir         = summaryDir(rootPath, filePath);
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

    // Persist to cache
    if (!abortSignal.aborted && accumulated) {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(sfp, accumulated, 'utf-8');
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

const DIR_SUMMARY_SYSTEM_PROMPT = `You are a senior software engineer writing internal documentation for an engineering team.
You will receive the relative path of a directory and a recursive listing of all files inside it.
Generate a clear, tutorial-style Markdown document that explains this directory's role and contents to a mid-level engineer.

## Format requirements
Use rich Markdown — headers, bold terms, inline code, tables, bullet lists, ASCII diagrams.

## Sections to include

### 1. Overview
What problem or domain does this directory own? One clear paragraph.

### 2. File Inventory
A table or annotated list of every file with a one-line description of its purpose.

### 3. Key Relationships & Entry Points
How do the files relate to each other? Which file should a new developer read first?
Include a simple ASCII diagram if the relationships are non-trivial:
\`\`\`text
index.ts → router.ts → handler.ts
                     ↘ middleware.ts
\`\`\`

### 4. Conventions & Patterns
Naming conventions, code patterns, architectural decisions, or anything easy to get wrong.

## Tone
Write as if *teaching*, not just listing. Explain the *why* behind the structure.`;

/** Walk a directory recursively and return all relative file paths (sorted). */
function walkDir(root: string, base: string = root): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
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
    if (!fs.statSync(absPath).isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
  } catch {
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
          { role: 'system', content: DIR_SUMMARY_SYSTEM_PROMPT },
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
        config: { systemInstruction: DIR_SUMMARY_SYSTEM_PROMPT },
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
        system: DIR_SUMMARY_SYSTEM_PROMPT,
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
      await fs.promises.writeFile(sfp, accumulated, 'utf-8');
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
