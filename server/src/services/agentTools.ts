import { randomUUID } from 'crypto';
import path from 'path';
import { Response } from 'express';
import { executeTool } from './fileTools';
import { requestTerminalApproval, runTerminalCommand } from './terminalCommands';
import { rootPath } from '../state';

export async function executeAgentTool(
  name: string,
  input: Record<string, unknown>,
  res: Response,
  abortSignal: { aborted: boolean },
  toolCallId?: string,
) {
  if (name === 'open_file') {
    let filePath = typeof input.path === 'string' ? input.path.trim() : '';
    if (!filePath) {
      return { content: 'path is required', preview: 'path is required', error: true };
    }
    // Some models (e.g. Gemini) may return a workspace-relative path; resolve to absolute.
    if (!path.isAbsolute(filePath) && rootPath) {
      filePath = path.join(rootPath, filePath);
    }
    // Models sometimes return integer args as strings; accept both.
    const toInt = (v: unknown, fallback: number): number => {
      if (typeof v === 'number') return Math.floor(v);
      if (typeof v === 'string') { const n = parseInt(v, 10); return isNaN(n) ? fallback : n; }
      return fallback;
    };
    const line = toInt(input.line, 1);
    const endLine = toInt(input.end_line, line);
    const startCol = typeof input.start_col !== 'undefined' ? toInt(input.start_col, 1) : undefined;
    const endCol = typeof input.end_col !== 'undefined' ? toInt(input.end_col, 1) : undefined;
    if (!abortSignal.aborted) {
      res.write(`event: open_file\ndata: ${JSON.stringify({ path: filePath, line, endLine, startCol, endCol })}\n\n`);
    }
    return { content: `Opened ${filePath} at line ${line}`, preview: `Opened ${filePath}:${line}`, error: false };
  }

  if (name === 'invoke_summary') {
    let filePath = typeof input.path === 'string' ? input.path.trim() : '';
    if (!filePath) {
      return { content: 'path is required', preview: 'path is required', error: true };
    }
    // Resolve to absolute if workspace-relative
    if (!path.isAbsolute(filePath) && rootPath) {
      filePath = path.join(rootPath, filePath);
    }
    if (!abortSignal.aborted) {
      res.write(`event: invoke_summary\ndata: ${JSON.stringify({ path: filePath })}\n\n`);
    }
    return { content: `Summary view opened for ${filePath}`, preview: `Summary: ${path.basename(filePath)}`, error: false };
  }

  if (name === 'git_commit_compose') {
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    if (!message) {
      return { content: 'message is required', preview: 'message is required', error: true };
    }
    if (!abortSignal.aborted) {
      res.write(`event: git_commit_compose\ndata: ${JSON.stringify({ message })}\n\n`);
    }
    return {
      content: 'Commit message populated for user review. No commit was created.',
      preview: 'Commit message populated for review',
      error: false,
    };
  }

  if (name !== 'run_terminal_command') return executeTool(name, input, toolCallId);

  const command = typeof input.command === 'string' ? input.command.trim() : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const longRunning = input.longRunning === true;

  if (!command || !reason) {
    return {
      content: 'command and reason are required',
      preview: 'command and reason are required',
      error: true,
    };
  }

  const id = toolCallId ?? randomUUID();
  const approved = await requestTerminalApproval({ id, command, reason, longRunning }, res, abortSignal);
  if (!approved) {
    return {
      content: 'The user rejected or did not respond to the terminal command request. Do not run it. Explain what could not be completed or propose a safe alternative.',
      preview: 'Command rejected by user',
      error: true,
    };
  }

  return runTerminalCommand({ id, command, reason, longRunning }, (stream, data) => {
    if (!abortSignal.aborted) {
      res.write(`event: command_output\ndata: ${JSON.stringify({ id, stream, data })}\n\n`);
    }
  });
}
