import { randomUUID } from 'crypto';
import path from 'path';
import { Response } from 'express';
import { executeTool, EDIT_APPROVAL_TOOL_NAMES, MUTATING_TOOL_NAMES } from './fileTools';
import { requestTerminalApproval, runTerminalCommand } from './terminalCommands';
import { describeProposedChange, requestEditApproval } from './editApproval';
import { rootPath } from '../state';

export interface AgentToolOptions {
  /** Plan mode is active — mutating tools are rejected outright. */
  planningMode?: boolean;
  /** An approved plan is being executed — update_plan_step joins the toolset. */
  executing?: boolean;
  /** 'manual' pauses edit_file/write_file until the user approves each change. */
  editApproval?: 'auto' | 'manual';
}

export async function executeAgentTool(
  name: string,
  input: Record<string, unknown>,
  res: Response,
  abortSignal: { aborted: boolean },
  toolCallId?: string,
  options?: AgentToolOptions,
) {
  if (options?.planningMode && MUTATING_TOOL_NAMES.has(name)) {
    return {
      content: `${name} is blocked in PLAN MODE. Research only — present your plan with propose_plan and end your turn.`,
      preview: `Blocked in plan mode: ${name}`,
      error: true,
    };
  }

  if (options?.editApproval === 'manual' && EDIT_APPROVAL_TOOL_NAMES.has(name)) {
    const filePath = typeof input.path === 'string' ? input.path.trim() : '';
    const op = name === 'write_file' ? 'write' : 'edit';
    const id = toolCallId ?? randomUUID();
    const approved = await requestEditApproval(
      { id, op, path: filePath, preview: describeProposedChange(op, filePath, input) },
      res,
      abortSignal,
    );
    if (!approved) {
      return {
        content: 'The user skipped this change. Do not retry the same edit without asking. Adapt the approach, move to the next step, or explain how skipping affects the rest of the plan.',
        preview: `Change skipped by user: ${filePath}`,
        error: true,
      };
    }
  }

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

if (name === 'propose_plan') {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const steps = Array.isArray(input.steps)
      ? input.steps.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
      : [];
    if (!title || steps.length === 0) {
      return { content: 'title and at least one step are required', preview: 'title and at least one step are required', error: true };
    }
    if (!abortSignal.aborted) {
      res.write(`event: plan\ndata: ${JSON.stringify({ title, steps })}\n\n`);
    }
    return {
      content: 'Plan submitted for user review. End your turn now - the user will approve it, give feedback, or keep planning. Do not restate every step in chat.',
      preview: `Plan ready: ${title}`,
      error: false,
    };
  }

  if (name === 'update_plan_step') {
    const toInt = (v: unknown): number => (typeof v === 'number' ? Math.floor(v) : typeof v === 'string' ? parseInt(v, 10) : NaN);
    const index = toInt(input.index);
    const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
    if (!Number.isFinite(index) || index < 1 || !summary) {
      return { content: 'index (1-based) and summary are required', preview: 'index and summary are required', error: true };
    }
    if (!abortSignal.aborted) {
      res.write(`event: plan_update\ndata: ${JSON.stringify({ index, status: 'done', summary })}\n\n`);
    }
    return { content: `Step ${index} recorded as completed. Continue with the next pending step.`, preview: `Step ${index} done`, error: false };
  }

  if (name === 'run_terminal_command') {
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

  if (name !== 'run_terminal_command') return executeTool(name, input);

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
