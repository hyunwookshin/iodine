import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ResolvedOperand } from './normalize';

export type OperandClass =
  | 'inside-project'
  | 'home'
  | 'root'
  | 'system'
  | 'outside'
  | 'glob'
  | 'url';

/**
 * Deliberately excludes /var and /private: the OS temp directory lives there, and anything
 * else under them still lands in `outside`, which is never auto-approved either.
 */
const SYSTEM_ROOT_NAMES = ['/etc', '/usr', '/bin', '/sbin', '/System', '/Library', '/opt'];

// On macOS these are symlinks into /private, and operand paths arrive already resolved.
const SYSTEM_ROOTS = SYSTEM_ROOT_NAMES.flatMap(dir => {
  try {
    return [fs.realpathSync(dir)];
  } catch {
    return [];
  }
});

const URL_PATTERN = /^([a-z][a-z0-9+.-]*:\/\/|[\w.-]+@[\w.-]+:)/i;

/** Compares whole segments, so /a/bc is not under /a/b. */
export function isUnder(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

export function classifyOperand(operand: ResolvedOperand, rootPath: string | null): OperandClass {
  if (operand.isGlob) return 'glob';
  if (URL_PATTERN.test(operand.raw)) return 'url';

  const target = operand.path;
  if (target === path.parse(target).root) return 'root';
  if (rootPath && isUnder(target, rootPath)) return 'inside-project';
  if (target === os.homedir()) return 'home';
  if (SYSTEM_ROOTS.some(dir => isUnder(target, dir))) return 'system';
  return 'outside';
}

/** Hidden files hold credentials and git internals, so an approved folder never covers them. */
export function hasHiddenSegment(target: string, prefix: string): boolean {
  if (!isUnder(target, prefix)) return false;
  const relative = path.relative(prefix, target);
  if (!relative) return false;
  return relative.split(path.sep).some(segment => segment.startsWith('.'));
}

/**
 * Whether approving `prefix` should also cover `target`. Gitignored paths are excluded too,
 * but that check needs git and lives with the rule store.
 */
export function coveredByPrefix(target: string, prefix: string): boolean {
  return isUnder(target, prefix) && !hasHiddenSegment(target, prefix);
}
