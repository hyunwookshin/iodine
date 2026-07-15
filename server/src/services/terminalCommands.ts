import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { rootPath } from '../state';
import type { ToolResult } from './fileTools';

export interface TerminalCommandRequest {
  id: string;
  command: string;
  reason: string;
  longRunning: boolean;
}

interface PendingCommand extends TerminalCommandRequest {
  createdAt: number;
  resolve: (approved: boolean) => void;
}

const pendingCommands = new Map<string, PendingCommand>();
const runningProcesses = new Map<string, ChildProcess>();
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 2 * 60 * 1000;
const LONG_RUNNING_CAPTURE_MS = 15 * 1000;
const MAX_CAPTURE_CHARS = 100_000;

export function requestTerminalApproval(
  request: TerminalCommandRequest,
  res: Response,
  abortSignal: { aborted: boolean },
): Promise<boolean> {
  const { id } = request;

  res.write(`event: command_approval\ndata: ${JSON.stringify({ id, command: request.command, reason: request.reason, longRunning: request.longRunning, cwd: rootPath })}\n\n`);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingCommands.delete(id);
      resolve(approved);
    };

    const timer = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS);
    pendingCommands.set(id, { ...request, createdAt: Date.now(), resolve: finish });

    const poll = setInterval(() => {
      if (settled) {
        clearInterval(poll);
      } else if (abortSignal.aborted) {
        clearInterval(poll);
        finish(false);
      }
    }, 250);
  });
}

export function resolveTerminalApproval(id: string, approved: boolean): boolean {
  const pending = pendingCommands.get(id);
  if (!pending) return false;
  pending.resolve(approved);
  return true;
}

function detectUrls(output: string): string[] {
  const matches = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s\x1b]*)?/gi) ?? [];
  return [...new Set(matches.map(url => url.replace(/[),.;]+$/, '').replace('0.0.0.0', 'localhost')))];
}

export async function runTerminalCommand(
  request: TerminalCommandRequest,
  onOutput?: (stream: 'stdout' | 'stderr', data: string) => void,
): Promise<ToolResult> {
  if (!rootPath) {
    return { content: 'No workspace open', preview: 'No workspace open', error: true };
  }

  return new Promise<ToolResult>((resolve) => {
    const id = randomUUID();
    const shell = process.env.SHELL || '/bin/bash';
    const child = spawn(shell, ['-lc', request.command], {
      cwd: rootPath!,
      env: process.env,
      detached: false,
    });
    runningProcesses.set(id, child);

    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;

    const append = (stream: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const text = chunk.toString();
      if (stream === 'stdout') stdout = (stdout + text).slice(-MAX_CAPTURE_CHARS);
      else stderr = (stderr + text).slice(-MAX_CAPTURE_CHARS);
      onOutput?.(stream, text);
    };

    child.stdout?.on('data', chunk => append('stdout', chunk));
    child.stderr?.on('data', chunk => append('stderr', chunk));

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null, stillRunning: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (!stillRunning) runningProcesses.delete(id);

      const urls = detectUrls(`${stdout}\n${stderr}`);
      const payload = {
        command: request.command,
        cwd: rootPath,
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
        stillRunning,
        processId: stillRunning ? id : undefined,
        urls,
      };
      const content = JSON.stringify(payload, null, 2);
      const status = stillRunning
        ? `Command is still running${urls.length ? ` at ${urls.join(', ')}` : ''}.`
        : `Command exited with code ${exitCode}${urls.length ? `. URLs: ${urls.join(', ')}` : ''}`;
      resolve({ content, preview: `${status}\n${(stdout || stderr).slice(-1200)}`, error: !stillRunning && exitCode !== 0 });
    };

    child.on('error', err => {
      stderr += err.message;
      finish(null, null, false);
    });
    child.on('exit', (code, signal) => finish(code, signal, false));

    const timer = setTimeout(() => {
      if (request.longRunning) {
        finish(null, null, true);
      } else {
        timedOut = true;
        child.kill('SIGTERM');
      }
    }, request.longRunning ? LONG_RUNNING_CAPTURE_MS : COMMAND_TIMEOUT_MS);
  });
}
