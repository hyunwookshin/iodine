import crypto from 'crypto';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { coveredByPrefix } from './operands';
import { sameSignature, type CommandPart, type Signature } from './signature';
import { COMMAND_EMBEDDING_FORMAT, COMMAND_EMBEDDING_MODEL, commandEmbeddingInput, cosineSimilarity } from './embeddings';

const execFileAsync = promisify(execFile);
const ruleMutations = new Map<string, Promise<void>>();

async function withRuleMutation<T>(workspacePath: string, mutate: () => Promise<T>): Promise<T> {
  const previous = ruleMutations.get(workspacePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  ruleMutations.set(workspacePath, current);
  await previous;
  try { return await mutate(); }
  finally {
    release();
    if (ruleMutations.get(workspacePath) === current) ruleMutations.delete(workspacePath);
  }
}

/**
 * Rollout switch, off unless asked for. While off, matches are still found and written to
 * approval-log.jsonl so the log can be read before anyone trusts it.
 *
 * Read on each call, not at import time: imports run before index.ts loads .env, so a
 * module-level constant would never see the variable.
 */
export function autoApproveEnabled(): boolean {
  return process.platform !== 'win32' && ['1', 'true'].includes(process.env.IODINE_AUTO_APPROVE ?? '');
}

export interface ApprovalRule extends Signature {
  id: string;
  /** Kept for rules saved before per-target scopes were introduced. */
  pathPrefix: string | null;
  pathScopes?: Array<{ path: string; descendants: boolean }>;
  createdAt: number;
  lastUsedAt: number | null;
  embedding?: number[];
  embeddingModel?: string;
  embeddingFormat?: string;
  autoApply?: boolean;
}

export type RuleScope = 'exact' | 'directory';

export function canUseDirectoryScope(part: CommandPart): boolean {
  if (!part.approvable || part.paths.length !== 1) return false;
  try { return fs.statSync(part.paths[0]).isDirectory(); } catch { return part.signature.program === 'mkdir'; }
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

/** Shared path retained for older rule files. New matching uses pathScopes. */
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

export async function saveRule(workspacePath: string, part: CommandPart, embedding?: number[] | null, scope: RuleScope = 'exact'): Promise<ApprovalRule> {
  if (!part.approvable) throw new Error(part.reason ?? 'command cannot be approved');
  if (scope === 'directory' && !canUseDirectoryScope(part)) throw new Error('directory scope is unavailable for this command');

  const pathScopes = part.paths.map(target => ({ path: target, descendants: scope === 'directory' }));
  const rule: ApprovalRule = {
    ...part.signature,
    id: crypto.randomUUID(),
    pathPrefix: commonAncestor(part.paths),
    pathScopes,
    autoApply: true,
    createdAt: Date.now(),
    lastUsedAt: null,
    ...(embedding ? { embedding, embeddingModel: COMMAND_EMBEDDING_MODEL, embeddingFormat: COMMAND_EMBEDDING_FORMAT } : {}),
  };
  await withRuleMutation(workspacePath, async () => {
    const rules = await loadRules(workspacePath);
    await writeRules(workspacePath, [...rules, rule]);
  });
  return rule;
}

export async function updateRuleEmbedding(workspacePath: string, id: string, embedding: number[]): Promise<void> {
  await withRuleMutation(workspacePath, async () => {
    const rules = await loadRules(workspacePath);
    if (!rules.some(rule => rule.id === id)) return;
    await writeRules(workspacePath, rules.map(rule => rule.id === id
      ? { ...rule, embedding, embeddingModel: COMMAND_EMBEDDING_MODEL, embeddingFormat: COMMAND_EMBEDDING_FORMAT }
      : rule));
  });
}

export async function findSimilarRule(
  workspacePath: string,
  part: CommandPart,
  embedding: number[],
): Promise<ApprovalRule | null> {
  if (!part.approvable) return null;

  let best: ApprovalRule | null = null;
  let bestScore = 0.84;
  for (const rule of await loadRules(workspacePath)) {
    if (rule.program !== part.signature.program || rule.subcommand !== part.signature.subcommand) continue;
    if (rule.embeddingModel !== COMMAND_EMBEDDING_MODEL || rule.embeddingFormat !== COMMAND_EMBEDDING_FORMAT || !Array.isArray(rule.embedding)) continue;
    const score = cosineSimilarity(rule.embedding, embedding);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

export async function deleteRule(workspacePath: string, id: string): Promise<boolean> {
  return withRuleMutation(workspacePath, async () => {
    const rules = await loadRules(workspacePath);
    const remaining = rules.filter(r => r.id !== id);
    if (remaining.length === rules.length) return false;
    await writeRules(workspacePath, remaining);
    return true;
  });
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
  const scopes = rule.pathScopes ?? (rule.pathPrefix === null ? [] : [{ path: rule.pathPrefix, descendants: false }]);
  if (scopes.length !== part.paths.length) return false;

  for (let index = 0; index < scopes.length; index += 1) {
    const target = part.paths[index];
    const scope = scopes[index];
    if (target !== scope.path && (!scope.descendants || !coveredByPrefix(target, scope.path))) return false;
    // Approving a folder never reaches ignored files inside it, but the user can still
    // point a rule straight at an ignored folder like dist.
    if (target !== scope.path && await isGitIgnored(workspacePath, target)) return false;
  }
  return true;
}

/** Every part of the command line has to be covered, or the user is asked as usual. */
export async function findMatch(workspacePath: string, parts: CommandPart[]): Promise<ApprovalRule[] | null> {
  if (parts.length === 0 || parts.some(p => !p.approvable)) return null;

  return withRuleMutation(workspacePath, async () => {
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
  });
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

export async function logDecision(
  workspacePath: string,
  command: string,
  parts: CommandPart[] | null,
  approved: boolean,
  savedScope: RuleScope | null,
): Promise<void> {
  const entry = {
    at: new Date().toISOString(),
    event: 'manual-decision',
    command,
    normalized: parts?.map(commandEmbeddingInput) ?? null,
    approved,
    savedScope,
  };
  try {
    const file = logFile(workspacePath);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch {
    // Logging must not change the user's approval decision.
  }
}

function label(signature: Signature, scopes: Array<{ path: string; descendants: boolean }>, workspacePath: string): string {
  const head = [signature.program, signature.subcommand, ...signature.flags, ...(signature.literalOperands ?? [])].filter(Boolean).join(' ');
  if (scopes.length === 0) return `same ${head}`;
  const targets = scopes.map(scope => {
    const relative = path.relative(workspacePath, scope.path) || 'this project';
    return scope.descendants ? `${relative} and its visible children` : relative;
  });
  return `same ${head} for ${targets.join(' and ')}`;
}

/** Plain-language description of what approving this command would allow, for the button. */
export function ruleLabel(part: CommandPart, workspacePath: string, scope: RuleScope = 'exact'): string {
  return label(part.signature, part.paths.map(target => ({ path: target, descendants: scope === 'directory' })), workspacePath);
}

export function ruleSummary(rule: ApprovalRule, workspacePath: string): string {
  const scopes = rule.pathScopes ?? (rule.pathPrefix === null ? [] : [{ path: rule.pathPrefix, descendants: false }]);
  return label(rule, scopes, workspacePath);
}
