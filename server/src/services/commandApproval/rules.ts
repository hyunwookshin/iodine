import crypto from 'crypto';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { coveredByPrefix } from './operands';
import { sameSignature, type CommandPart, type Signature } from './signature';

const execFileAsync = promisify(execFile);

/**
 * Rollout switch, off unless asked for. While off, matches are still found and written to
 * approval-log.jsonl so the log can be read before anyone trusts it.
 *
 * Read on each call, not at import time: imports run before index.ts loads .env, so a
 * module-level constant would never see the variable.
 */
export function autoApproveEnabled(): boolean {
  return ['1', 'true'].includes(process.env.IODINE_AUTO_APPROVE ?? '');
}

export interface ApprovalRule extends Signature {
  id: string;
  /** Folder the approval was scoped to. Null when the command takes no paths. */
  pathPrefix: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

function rulesFile(workspacePath: string): string {
  const hash = crypto.createHash('md5').update(workspacePath).digest('hex');
  return path.join(os.homedir(), '.iodine', hash, 'approval-rules.json');
}

function logFile(workspacePath: string): string {
  return path.join(path.dirname(rulesFile(workspacePath)), 'approval-log.jsonl');
}

export async function loadRules(workspacePath: string): Promise<ApprovalRule[]> {
  try {
    const raw = await fs.promises.readFile(rulesFile(workspacePath), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A missing or damaged file means no rules, never a crash on an approval prompt.
    return [];
  }
}

async function writeRules(workspacePath: string, rules: ApprovalRule[]): Promise<void> {
  const file = rulesFile(workspacePath);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(rules, null, 2), 'utf-8');
}

/** Deepest folder containing every target, so a rule is never broader than what was approved. */
export function commonAncestor(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const split = paths.map(p => p.split(path.sep));
  const shared: string[] = [];
  for (let i = 0; i < split[0].length; i += 1) {
    const segment = split[0][i];
    if (!split.every(parts => parts[i] === segment)) break;
    shared.push(segment);
  }
  return shared.join(path.sep) || path.sep;
}

export async function saveRule(workspacePath: string, part: CommandPart): Promise<ApprovalRule> {
  if (!part.approvable) throw new Error(part.reason ?? 'command cannot be approved');

  const rule: ApprovalRule = {
    ...part.signature,
    id: crypto.randomUUID(),
    pathPrefix: commonAncestor(part.paths),
    createdAt: Date.now(),
    lastUsedAt: null,
  };
  const rules = await loadRules(workspacePath);
  await writeRules(workspacePath, [...rules, rule]);
  return rule;
}

export async function deleteRule(workspacePath: string, id: string): Promise<boolean> {
  const rules = await loadRules(workspacePath);
  const remaining = rules.filter(r => r.id !== id);
  if (remaining.length === rules.length) return false;
  await writeRules(workspacePath, remaining);
  return true;
}

async function isGitIgnored(workspacePath: string, target: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['check-ignore', '--quiet', '--', target], { cwd: workspacePath });
    return true;
  } catch {
    // Exit 1 means not ignored; anything else means we could not tell, and we do not guess.
    return false;
  }
}

async function ruleReaches(workspacePath: string, rule: ApprovalRule, part: CommandPart): Promise<boolean> {
  if (!sameSignature(rule, part.signature)) return false;
  if (rule.pathPrefix === null) return part.paths.length === 0;

  for (const target of part.paths) {
    if (!coveredByPrefix(target, rule.pathPrefix)) return false;
    // Approving a folder never reaches ignored files inside it, but the user can still
    // point a rule straight at an ignored folder like dist.
    if (target !== rule.pathPrefix && await isGitIgnored(workspacePath, target)) return false;
  }
  return true;
}

/** Every part of the command line has to be covered, or the user is asked as usual. */
export async function findMatch(workspacePath: string, parts: CommandPart[]): Promise<ApprovalRule[] | null> {
  if (parts.length === 0 || parts.some(p => !p.approvable)) return null;

  const rules = await loadRules(workspacePath);
  if (rules.length === 0) return null;

  const matched: ApprovalRule[] = [];
  for (const part of parts) {
    let hit: ApprovalRule | undefined;
    for (const rule of rules) {
      if (await ruleReaches(workspacePath, rule, part)) {
        hit = rule;
        break;
      }
    }
    if (!hit) return null;
    matched.push(hit);
  }

  const usedAt = Date.now();
  const ids = new Set(matched.map(r => r.id));
  await writeRules(workspacePath, rules.map(r => (ids.has(r.id) ? { ...r, lastUsedAt: usedAt } : r)));
  return matched;
}

export async function logMatch(
  workspacePath: string,
  command: string,
  matched: ApprovalRule[],
  applied: boolean,
): Promise<void> {
  const entry = {
    at: new Date().toISOString(),
    command,
    applied,
    ruleIds: matched.map(r => r.id),
  };
  try {
    const file = logFile(workspacePath);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch {
    // The log is for us, not the user; never fail an approval because it could not be written.
  }
}

function label(signature: Signature, prefix: string | null, workspacePath: string): string {
  const head = [signature.program, signature.subcommand, ...signature.flags].filter(Boolean).join(' ');
  if (!prefix) return `any ${head}`;
  return `any ${head} in ${path.relative(workspacePath, prefix) || 'this project'}`;
}

/** Plain-language description of what approving this command would allow, for the button. */
export function ruleLabel(part: CommandPart, workspacePath: string): string {
  return label(part.signature, commonAncestor(part.paths), workspacePath);
}

export function ruleSummary(rule: ApprovalRule, workspacePath: string): string {
  return label(rule, rule.pathPrefix, workspacePath);
}
