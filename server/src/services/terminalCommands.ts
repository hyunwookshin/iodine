import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { rootPath } from '../state';
import type { ToolResult } from './fileTools';
import { autoApproveEnabled, canUseDirectoryScope, findMatch, findSimilarRule, loadRules, logDecision, logMatch, ruleLabel, ruleSummary, saveRule, updateRuleEmbedding, type ApprovalRule, type RuleScope } from './commandApproval/rules';
import { describeCommand, type CommandPart } from './commandApproval/signature';
import { COMMAND_EMBEDDING_FORMAT, COMMAND_EMBEDDING_MODEL, commandEmbeddingInput, embedCommand } from './commandApproval/embeddings';

export interface TerminalCommandRequest {
  id: string;
  command: string;
  reason: string;
  longRunning: boolean;
}

interface PendingCommand extends TerminalCommandRequest {
  createdAt: number;
  resolve: (approved: boolean) => void;
  workspace: string | null;
  /** Null when the command could not be resolved. */
  parts: CommandPart[] | null;
}

const pendingCommands = new Map<string, PendingCommand>();
const runningProcesses = new Map<string, ChildProcess>();
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 2 * 60 * 1000;
const LONG_RUNNING_CAPTURE_MS = 15 * 1000;
const MAX_CAPTURE_CHARS = 100_000;

/** Describes the command, and reports any saved rule that already covers all of it. */
async function inspect(command: string, workspace: string | null): Promise<{ parts: CommandPart[] | null; matched: ApprovalRule[] | null; similarRuleLabel: string | null }> {
  if (!workspace) return { parts: null, matched: null, similarRuleLabel: null };

  const described = describeCommand(command, workspace, workspace);
  if (!described.ok) return { parts: null, matched: null, similarRuleLabel: null };

  const matched = await findMatch(workspace, described.parts);

  let similarRuleLabel: string | null = null;
  if (!matched && described.parts.length === 1 && described.parts[0].approvable) {
    const rules = await loadRules(workspace);
    const hasCandidates = rules.some(rule =>
      rule.program === described.parts[0].signature.program &&
      rule.subcommand === described.parts[0].signature.subcommand &&
      rule.embeddingModel === COMMAND_EMBEDDING_MODEL &&
      rule.embeddingFormat === COMMAND_EMBEDDING_FORMAT,
    );
    if (hasCandidates) {
      try {
        const embedding = await embedCommand(commandEmbeddingInput(described.parts[0]));
        const similar = await findSimilarRule(workspace, described.parts[0], embedding);
        if (similar) similarRuleLabel = ruleSummary(similar, workspace);
      } catch {
        // Suggestions do not affect whether the user can approve a command.
      }
    }
  }
  return { parts: described.parts, matched, similarRuleLabel };
}

export async function requestTerminalApproval(
  request: TerminalCommandRequest,
  res: Response,
  abortSignal: { aborted: boolean },
): Promise<boolean> {
  const { id } = request;
  const workspace = rootPath;
  const { parts, matched, similarRuleLabel } = await inspect(request.command, workspace);
  const remembered = parts !== null && parts.every(p => p.approvable);
  const autoApproved = matched && workspace === rootPath && process.platform !== 'win32' && (autoApproveEnabled() || matched.every(rule => rule.autoApply === true));
  if (matched && workspace) await logMatch(workspace, request.command, matched, Boolean(autoApproved));

  if (autoApproved) {
    res.write(`event: command_approval\ndata: ${JSON.stringify({ id, command: request.command, reason: request.reason, longRunning: request.longRunning, cwd: rootPath, autoApproved: true })}\n\n`);
    return true;
  }

  res.write(`event: command_approval\ndata: ${JSON.stringify({
    id,
    command: request.command,
    reason: request.reason,
    longRunning: request.longRunning,
    cwd: rootPath,
    rememberLabel: remembered && workspace ? parts.map(p => ruleLabel(p, workspace)).join(', ') : null,
    directoryLabel: remembered && workspace && parts.length === 1 && canUseDirectoryScope(parts[0])
      ? ruleLabel(parts[0], workspace, 'directory') : null,
    similarRuleLabel,
  })}\n\n`);

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
    pendingCommands.set(id, { ...request, createdAt: Date.now(), resolve: finish, workspace, parts });

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

export async function resolveTerminalApproval(id: string, approved: boolean, remember = false, scope: RuleScope = 'exact'): Promise<boolean> {
  const pending = pendingCommands.get(id);
  if (!pending) return false;
  if (pending.workspace !== rootPath) {
    pending.resolve(false);
    return true;
  }

  let savedScope: RuleScope | null = null;
  let savedRuleId: string | null = null;
  if (approved && remember && pending.parts?.every(part => part.approvable) && pending.workspace) {
    try {
      for (const part of pending.parts) {
        const rule = await saveRule(pending.workspace, part, null, scope);
        if (pending.parts.length === 1) savedRuleId = rule.id;
      }
      savedScope = scope;
    } catch {
      // Failing to remember must never cost the user the approval they just gave.
    }
  }

  if (pending.workspace) await logDecision(pending.workspace, pending.command, pending.parts, approved, savedScope);

  pending.resolve(approved);
  if (savedRuleId && pending.workspace && pending.parts) {
    const workspace = pending.workspace;
    const ruleId = savedRuleId;
    const input = commandEmbeddingInput(pending.parts[0]);
    void embedCommand(input).then(embedding => updateRuleEmbedding(workspace, ruleId, embedding)).catch(() => {});
  }
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
    // Windows: always use cmd.exe. SHELL is ignored because Git Bash/MSYS set it to
    // a POSIX path (/usr/bin/bash) that Windows can't spawn directly.
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/bash';
    // Wrap in quotes + verbatim args (same as Node's own `shell: true`) so Node
    // doesn't backslash-escape quotes, which cmd.exe doesn't understand.
    const shellArgs = isWindows ? ['/d', '/s', '/c', `"${request.command}"`] : ['-lc', request.command];
    const child = spawn(shell, shellArgs, {
      cwd: rootPath!,
      env: process.env,
      detached: false,
      windowsVerbatimArguments: isWindows,
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
