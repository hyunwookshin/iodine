import fs from 'fs';
import path from 'path';
import { buildTree, readFileContent, writeFileContent, validatePath } from './fileSystem';
import { saveSnapshot } from './editSnapshots';
import { rootPath } from '../state';

export type ToolResult = { content: string; preview: string; error: boolean };

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);

/** Returns true if the filename matches a simple glob pattern (*, ?, no path separators). */
function matchGlob(name: string, glob: string): boolean {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(name);
}

// ── .NO_AGENT_ACCESS ──────────────────────────────────────────────────────────

function globPatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\x00/g, '.*');
  return new RegExp(`^${escaped}$`);
}

async function getNoAgentAccessPatterns(workspaceRoot: string): Promise<RegExp[]> {
  try {
    const content = await fs.promises.readFile(path.join(workspaceRoot, '.NO_AGENT_ACCESS'), 'utf-8');
    return content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(globPatternToRegex);
  } catch {
    return [];
  }
}

function isAgentAccessBlocked(absPath: string, workspaceRoot: string, patterns: RegExp[]): boolean {
  if (patterns.length === 0) return false;
  const rel = path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
  return patterns.some(re => re.test(rel));
}

/** Resolve a tool-provided path against the workspace and enforce the workspace boundary. */
function resolveToolPath(inputPath: string): string {
  if (!rootPath) throw new Error('No workspace open');
  const abs = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(rootPath, inputPath);
  validatePath(abs, rootPath);
  return abs;
}

async function searchFiles(query: string, searchPath?: string, glob?: string): Promise<string> {
  const base = searchPath ? resolveToolPath(searchPath) : rootPath!;
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
        if (!IGNORED_DIRS.has(entry.name)) await walk(fullPath);
      } else if (entry.isFile()) {
        if (glob && !matchGlob(entry.name, glob)) continue;
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
  return results.slice(0, 200).join('\n');
}

export async function executeTool(name: string, input: Record<string, unknown>, toolCallId?: string): Promise<ToolResult> {
  try {
    if (name === 'read_file') {
      if (!rootPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
      const absForCheck = path.isAbsolute(input.path as string)
        ? path.resolve(input.path as string)
        : path.resolve(rootPath, input.path as string);
      const blockPatterns = await getNoAgentAccessPatterns(rootPath);
      if (isAgentAccessBlocked(absForCheck, rootPath, blockPatterns)) {
        return { content: `Access denied: "${input.path}" is restricted by .NO_AGENT_ACCESS.`, preview: 'Access denied', error: true };
      }
      const full = await readFileContent(input.path as string, rootPath);
      const startLine = typeof input.start_line === 'number' ? input.start_line : null;
      const endLine   = typeof input.end_line   === 'number' ? input.end_line   : null;
      if (startLine !== null) {
        const lines = full.split('\n');
        const from = Math.max(0, startLine - 1);
        const to   = endLine !== null ? Math.min(lines.length, endLine) : lines.length;
        const slice = lines.slice(from, to).map((l, i) => `${from + i + 1}: ${l}`).join('\n');
        return { content: slice, preview: slice.slice(0, 200), error: false };
      }
      return { content: full, preview: full.slice(0, 200), error: false };
    }

    if (name === 'write_file') {
      if (!rootPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
      const filePath = input.path as string;
      const content = input.content as string;
      const abs = resolveToolPath(filePath);
      const blockPatterns = await getNoAgentAccessPatterns(rootPath);
      if (isAgentAccessBlocked(abs, rootPath, blockPatterns)) {
        return { content: `Access denied: "${filePath}" is restricted by .NO_AGENT_ACCESS.`, preview: 'Access denied', error: true };
      }
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      if (toolCallId) await saveSnapshot(rootPath, toolCallId, abs, content, name);
      await writeFileContent(abs, content, rootPath);
      return { content: `File written: ${filePath}`, preview: `File written: ${filePath}`, error: false };
    }

    if (name === 'edit_file') {
      if (!rootPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
      const filePath = input.path as string;
      const oldString = input.old_string as string;
      const newString = input.new_string as string;
      const abs = resolveToolPath(filePath);
      const blockPatterns = await getNoAgentAccessPatterns(rootPath);
      if (isAgentAccessBlocked(abs, rootPath, blockPatterns)) {
        return { content: `Access denied: "${filePath}" is restricted by .NO_AGENT_ACCESS.`, preview: 'Access denied', error: true };
      }
      const original = await fs.promises.readFile(abs, 'utf-8');
      const count = original.split(oldString).length - 1;
      if (count === 0) {
        return { content: `edit_file failed: old_string not found in ${filePath}. Read the file first to confirm the exact text.`, preview: 'old_string not found', error: true };
      }
      if (count > 1) {
        return { content: `edit_file failed: old_string matches ${count} locations in ${filePath}. Add more surrounding context to make it unique.`, preview: `${count} matches — ambiguous`, error: true };
      }
      const updated = original.replace(oldString, newString);
      if (toolCallId) await saveSnapshot(rootPath, toolCallId, abs, updated, name);
      await writeFileContent(abs, updated, rootPath);
      const added = newString.split('\n').length - oldString.split('\n').length;
      const summary = added === 0 ? 'lines replaced' : added > 0 ? `+${added} lines` : `${added} lines`;
      return { content: `Edited ${filePath} (${summary})`, preview: `Edited ${filePath} (${summary})`, error: false };
    }

    if (name === 'list_directory') {
      const dirPath = (input.path as string | undefined) || rootPath;
      if (!dirPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
      const tree = await buildTree(resolveToolPath(dirPath), 0, 3);
      const content = JSON.stringify(tree, null, 2);
      return { content, preview: content.slice(0, 200), error: false };
    }

    if (name === 'search_files') {
      const searchPath = input.path as string | undefined;
      if (!searchPath && !rootPath) return { content: 'No workspace open', preview: 'No workspace open', error: true };
      const content = await searchFiles(input.query as string, searchPath, input.glob as string | undefined);
      return { content, preview: content.slice(0, 200), error: false };
    }

    return { content: `Unknown tool: ${name}`, preview: `Unknown tool: ${name}`, error: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: msg, preview: msg.slice(0, 200), error: true };
  }
}

export const TOOL_SCHEMAS = {
  read_file: {
    description: 'Read the contents of a file in the workspace. Use start_line and end_line to read a specific range instead of the whole file — prefer this for large files to avoid unnecessary context.',
    parameters: {
      type: 'object' as const,
      properties: {
        path:       { type: 'string',  description: 'Absolute path to the file' },
        start_line: { type: 'integer', description: 'First line to read (1-based, inclusive). Omit to read from the beginning.' },
        end_line:   { type: 'integer', description: 'Last line to read (1-based, inclusive). Omit to read to the end of the file.' },
      },
      required: ['path'],
    },
  },
  edit_file: {
    description: 'Edit a file by replacing an exact string with a new string. Prefer this over write_file when modifying an existing file — only the changed lines are needed. old_string must match exactly once in the file; if it matches zero or multiple times an error is returned and you should retry with more surrounding context. For new files use write_file instead.',
    parameters: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute or workspace-relative path to the file' },
        old_string: { type: 'string', description: 'The exact string to replace (must match exactly once)' },
        new_string: { type: 'string', description: 'The string to replace it with' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  write_file: {
    description: 'Write content to a file in the workspace. Use for creating new files. For modifying existing files prefer edit_file. Creates parent directories if needed.',
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
    description: 'Search for text across files in the workspace (grep-like, case-insensitive). Returns matching lines with file paths and line numbers. Use glob to restrict to specific file types (e.g. "*.ts", "*.py").',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string',  description: 'Text to search for (case-insensitive)' },
        path:  { type: 'string',  description: 'Directory to search in (defaults to workspace root)' },
        glob:  { type: 'string',  description: 'File name pattern to restrict search (e.g. "*.ts", "*.py", "*.json")' },
      },
      required: ['query'],
    },
  },
  git_commit_compose: {
    description: 'Populate the Source Control commit message editor with a proposed message. This does not run git commit; the user reviews the message and finishes by clicking Commit.',
    parameters: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'The complete commit message to place in the Source Control message editor' },
      },
      required: ['message'],
    },
  },
  run_terminal_command: {
    description: 'Propose a terminal command in the workspace. This tool pauses until the user explicitly approves or rejects it. After approval, its captured stdout, stderr, exit code, and detected localhost URLs are returned so you can interpret the result and continue. Use longRunning for development servers and watchers.',
    parameters: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The exact shell command to run' },
        reason: { type: 'string', description: 'A short explanation of why this command is needed' },
        longRunning: { type: 'boolean', description: 'Set true for dev servers, watchers, or commands expected to keep running' },
      },
      required: ['command', 'reason'],
    },
  },
  invoke_summary: {
    description: 'Open the AI summary view for a file. Use this when the user asks you to explain a file or module — the summary view opens in the editor alongside the system diagram and table of contents. The summary is generated automatically if it has not been created yet.',
    parameters: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Workspace-relative path to the file to summarize (e.g. "client/src/hooks/useOpenFiles.ts")' },
      },
      required: ['path'],
    },
  },
  open_file: {
    description: 'Open a file in the editor and highlight a range of lines to draw the user\'s attention to specific code. Use this to walk through the codebase, point out relevant sections, or guide the user to where changes should be made without making the changes yourself. For ranges of fewer than 5 lines, also supply start_col and end_col to highlight the exact expression or token rather than the whole line — read the file content carefully to count columns accurately (1-based, tabs count as 1).',
    parameters: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to open' },
        line: { type: 'integer', description: 'Line number to scroll to and start highlighting (1-based)' },
        end_line: { type: 'integer', description: 'Last line of the highlighted range (inclusive, defaults to line if omitted)' },
        start_col: { type: 'integer', description: 'First column of the highlight on the start line (1-based, inclusive). Omit to highlight the whole line.' },
        end_col: { type: 'integer', description: 'Last column of the highlight on the end line (1-based, exclusive). Omit to highlight the whole line.' },
      },
      required: ['path', 'line'],
    },
  },
  enter_planning_mode: {
    description: 'Switch into planning mode. Use when a task needs a multi-step plan ' +
    '(multiple files, architectural decisions, unclear requirements). ' +
    'Not for small, well-defined edits. In planning mode you can read and search ' +
    'but cannot edit or create files.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  exit_planning_mode: {
    description:
      'Leave planning mode and begin executing the plan. Only call this after you ' +
      'have presented a plan with draft_plan and the user has explicitly approved it. ' +
      'If the user asks for changes, revise the plan with draft_plan instead. ' +
      'After exiting, you can use edit_file and write_file to carry out the plan.',
    parameters: { 
      type: 'object', 
      properties: {} 
    },
  },
  draft_plan: {
    description: 'Present a step-by-step plan to the user for review. Call this once you have ' +
    'explored the code enough to propose an approach. After calling it, stop and ' +
    'wait for the user\'s feedback. Do not start implementing.',
    parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One or two sentences on the approach.' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                files: { type: 'array', items: { type: 'string' } },
              },
              required: ['description'],
            },
          },
        },
        required: ['summary', 'steps'],
    }
  }
} as const;
