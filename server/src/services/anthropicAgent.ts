import Anthropic from '@anthropic-ai/sdk';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { Response } from 'express';
import { buildTree, readFileContent, writeFileContent } from './fileSystem';
import { rootPath } from '../state';

export async function loadApiKey(): Promise<string> {
  try {
    const keyFile = path.join(os.homedir(), '.anthropic', 'api_key');
    const key = await fs.promises.readFile(keyFile, 'utf-8');
    return key.trim();
  } catch {
    // fall through
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  throw new Error('API key not found');
}

async function searchFiles(query: string, searchPath?: string): Promise<string> {
  const base = searchPath
    ? path.resolve(searchPath)
    : rootPath!;

  const results: string[] = [];

  async function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);
        if (!ignored.has(entry.name)) await walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const content = await fs.promises.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
              results.push(`${fullPath}:${idx + 1}: ${line.trim()}`);
            }
          });
        } catch {
          // skip binary / unreadable files
        }
      }
    }
  }

  await walk(base);
  if (results.length === 0) return 'No matches found.';
  return results.slice(0, 100).join('\n');
}

type ToolResult = { content: string; preview: string; error: boolean };

async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    if (name === 'read_file') {
      const filePath = input.path as string;
      if (!rootPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
      const content = await readFileContent(filePath, rootPath);
      return { content, preview: content.slice(0, 200), error: false };
    }

    if (name === 'write_file') {
      const filePath = input.path as string;
      const content = input.content as string;
      if (!rootPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
      const abs = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      await writeFileContent(abs, content, rootPath);
      return { content: `File written: ${filePath}`, preview: `File written: ${filePath}`, error: false };
    }

    if (name === 'list_directory') {
      const dirPath = (input.path as string | undefined) || rootPath;
      if (!dirPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
      const tree = await buildTree(dirPath, 0, 3);
      const content = JSON.stringify(tree, null, 2);
      return { content, preview: content.slice(0, 200), error: false };
    }

    if (name === 'search_files') {
      const query = input.query as string;
      const searchPath = input.path as string | undefined;
      if (!searchPath && !rootPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
      const content = await searchFiles(query, searchPath);
      return { content, preview: content.slice(0, 200), error: false };
    }

    return { content: `Unknown tool: ${name}`, preview: `Unknown tool: ${name}`, error: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: msg, preview: msg.slice(0, 200), error: true };
  }
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace. Creates parent directories if needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or workspace-relative path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List the directory tree of the workspace (up to depth 3).',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list (defaults to workspace root)' },
      },
    },
  },
  {
    name: 'search_files',
    description: 'Search for text in files within the workspace (grep-like).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        path: { type: 'string', description: 'Directory to search in (defaults to workspace root)' },
      },
      required: ['query'],
    },
  },
];

function writeSSE(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function runAgentLoop(
  messages: Anthropic.MessageParam[],
  model: string,
  res: Response,
  abortSignal: { aborted: boolean },
  activeFile: string | null = null,
) {
  const apiKey = await loadApiKey();
  const client = new Anthropic({ apiKey });

  const workspaceInfo = rootPath ? `Workspace: ${rootPath}` : 'No workspace is currently open.';
  const activeFileInfo = activeFile ? `The user currently has this file open in the editor: ${activeFile}` : '';
  const system = `You are a coding assistant with access to the user's project files.
${workspaceInfo}
${activeFileInfo}

You can read, write, list, and search files. When modifying files, read them first.
Be concise. Show diffs or full updated files when making changes.`;

  const history = [...messages];

  while (true) {
    if (abortSignal.aborted) return;

    const stream = client.messages.stream({
      model,
      max_tokens: 8096,
      system,
      tools: TOOLS,
      messages: history,
    });

    for await (const event of stream) {
      if (abortSignal.aborted) return;
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        writeSSE(res, 'text_delta', { text: event.delta.text });
      }
    }

    const finalMessage = await stream.finalMessage();
    if (abortSignal.aborted) return;

    const toolUseBlocks = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUseBlocks.length === 0) {
      // No more tool calls — done
      writeSSE(res, 'done', {});
      return;
    }

    // Append assistant message
    history.push({ role: 'assistant', content: finalMessage.content });

    // Execute tools and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      if (abortSignal.aborted) return;
      writeSSE(res, 'tool_call', { id: toolUse.id, name: toolUse.name, input: toolUse.input });

      const result = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
      writeSSE(res, 'tool_result', {
        tool_use_id: toolUse.id,
        name: toolUse.name,
        preview: result.preview,
        error: result.error,
      });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result.content,
        is_error: result.error,
      });
    }

    history.push({ role: 'user', content: toolResults });
  }
}
