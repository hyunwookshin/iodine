import fs from 'fs';
import path from 'path';
import { buildTree, readFileContent, writeFileContent } from './fileSystem';
import { rootPath } from '../state';

export type ToolResult = { content: string; preview: string; error: boolean };

async function searchFiles(query: string, searchPath?: string): Promise<string> {
  const base = searchPath ? path.resolve(searchPath) : rootPath!;
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
          content.split('\n').forEach((line, idx) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
              results.push(`${fullPath}:${idx + 1}: ${line.trim()}`);
            }
          });
        } catch { /* skip binary / unreadable */ }
      }
    }
  }

  await walk(base);
  if (results.length === 0) return 'No matches found.';
  return results.slice(0, 100).join('\n');
}

export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    if (name === 'read_file') {
      if (!rootPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
      const content = await readFileContent(input.path as string, rootPath);
      return { content, preview: content.slice(0, 200), error: false };
    }

    if (name === 'write_file') {
      if (!rootPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
      const filePath = input.path as string;
      const content = input.content as string;
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
      const searchPath = input.path as string | undefined;
      if (!searchPath && !rootPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
      const content = await searchFiles(input.query as string, searchPath);
      return { content, preview: content.slice(0, 200), error: false };
    }

    return { content: `Unknown tool: ${name}`, preview: `Unknown tool: ${name}`, error: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: msg, preview: msg.slice(0, 200), error: true };
  }
}

/** Provider-agnostic tool parameter schemas (reused by both agents). */
export const TOOL_SCHEMAS = {
  read_file: {
    description: 'Read the contents of a file in the workspace.',
    parameters: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path to the file' } },
      required: ['path'],
    },
  },
  write_file: {
    description: 'Write content to a file in the workspace. Creates parent directories if needed.',
    parameters: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute or workspace-relative path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  list_directory: {
    description: 'List the directory tree of the workspace (up to depth 3).',
    parameters: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Directory path to list (defaults to workspace root)' } },
    },
  },
  search_files: {
    description: 'Search for text in files within the workspace (grep-like).',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        path: { type: 'string', description: 'Directory to search in (defaults to workspace root)' },
      },
      required: ['query'],
    },
  },
} as const;
