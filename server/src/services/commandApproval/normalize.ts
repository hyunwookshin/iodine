import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as tokenize } from 'shell-quote';

export interface ResolvedOperand {
  raw: string;
  /** Absolute, with `~` expanded and symlinks resolved. Globs keep their pattern unresolved. */
  path: string;
  exists: boolean;
  isGlob: boolean;
}

export interface ResolvedCommand {
  program: string;
  /** Long form where known, clusters split, sorted. */
  flags: string[];
  operands: ResolvedOperand[];
  cwd: string;
}

export type NormalizeResult =
  | { ok: true; commands: ResolvedCommand[] }
  /** Runs as normal, but can never be saved as a rule. */
  | { ok: false; reason: 'unresolvable'; detail: string }
  | { ok: false; reason: 'never-allowed'; detail: string };

const PRIVILEGE_ESCALATORS = new Set(['sudo', 'su', 'doas', 'runas']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'ksh', 'dash']);
const SEPARATORS = new Set(['&&', '||', ';', '|']);

const FLAG_ALIASES: Record<string, Record<string, string>> = {
  rm: { '-r': '--recursive', '-R': '--recursive', '-f': '--force', '-i': '--interactive', '-d': '--dir', '-v': '--verbose' },
  cp: { '-r': '--recursive', '-R': '--recursive', '-f': '--force', '-i': '--interactive', '-v': '--verbose' },
  mv: { '-f': '--force', '-i': '--interactive', '-n': '--no-clobber', '-v': '--verbose' },
  mkdir: { '-p': '--parents', '-v': '--verbose' },
  git: { '-f': '--force', '-v': '--verbose' },
  npm: { '-g': '--global', '-D': '--save-dev' },
};

/** shell-quote expands `$VAR` to an empty string, which would silently turn `rm -rf $DIR` into `rm -rf`. */
function hasUnresolvableSyntax(command: string): string | null {
  if (command.includes('`')) return 'backtick substitution';
  if (/\$[({\w]/.test(command)) return 'variable or command substitution';
  if (/<\(|>\(/.test(command)) return 'process substitution';
  return null;
}

function resolvePath(raw: string, cwd: string): { path: string; exists: boolean } {
  const expanded = raw === '~' || raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(1)) : raw;
  const absolute = path.resolve(cwd, expanded);

  let existing = absolute;
  const missing: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return { path: absolute, exists: false };
    missing.unshift(path.basename(existing));
    existing = parent;
  }

  try {
    const real = fs.realpathSync(existing);
    return missing.length
      ? { path: path.join(real, ...missing), exists: false }
      : { path: real, exists: true };
  } catch {
    return { path: absolute, exists: missing.length === 0 };
  }
}

function expandFlag(flag: string, program: string): string[] {
  const aliases = FLAG_ALIASES[program] ?? {};
  if (flag.startsWith('--')) return [flag];

  // A cluster like -rf is the same as -r -f, but a long single-dash flag like find's
  // -exec is not. Only split when every letter is a flag we know for this program.
  const chars = flag.slice(1);
  if (chars.length > 1 && chars.split('').every(c => aliases[`-${c}`])) {
    return chars.split('').map(c => aliases[`-${c}`]);
  }
  return [aliases[flag] ?? flag];
}

type GlobToken = { op: 'glob'; pattern: string };
type Segment = (string | GlobToken)[];

function splitSegments(tokens: ReturnType<typeof tokenize>): Segment[] | string {
  const segments: Segment[] = [];
  let current: Segment = [];

  for (const token of tokens) {
    if (typeof token === 'object' && 'op' in token && token.op !== 'glob') {
      if (!SEPARATORS.has(token.op)) return token.op;
      segments.push(current);
      current = [];
      continue;
    }
    current.push(token as string | GlobToken);
  }
  segments.push(current);
  return segments.filter(s => s.length > 0);
}

type SegmentFailure = { ok: false; reason: 'unresolvable' | 'never-allowed'; detail: string };

function rejectProgram(program: string, segment: Segment, piped: boolean): SegmentFailure | null {
  if (PRIVILEGE_ESCALATORS.has(program)) {
    return { ok: false, reason: 'never-allowed', detail: `${program} escalates privileges` };
  }
  if (SHELLS.has(program) && (piped || segment.includes('-c'))) {
    return { ok: false, reason: 'never-allowed', detail: `${program} runs an unknown script` };
  }
  return null;
}

function readArguments(
  segment: Segment,
  program: string,
  cwd: string,
): { flags: string[]; operands: ResolvedOperand[] } | SegmentFailure {
  const flags: string[] = [];
  const operands: ResolvedOperand[] = [];
  let literalOnly = false;

  for (const token of segment.slice(1)) {
    if (typeof token !== 'string') {
      operands.push({ raw: token.pattern, path: token.pattern, exists: false, isGlob: true });
      continue;
    }
    if (token === '--') {
      literalOnly = true;
      continue;
    }
    if (!literalOnly && token.startsWith('-') && token.length > 1) {
      flags.push(...expandFlag(token, program));
      continue;
    }
    // `~user` expands from the password database, which we cannot read here.
    if (token.startsWith('~') && token !== '~' && !token.startsWith('~/')) {
      return { ok: false, reason: 'unresolvable', detail: 'user home expansion' };
    }
    const { path: resolved, exists } = resolvePath(token, cwd);
    operands.push({ raw: token, path: resolved, exists, isGlob: false });
  }

  return { flags: [...flags].sort(), operands };
}

/** `cd` is not an action to remember; it only moves where the next command resolves from. */
function nextCwd(operands: ResolvedOperand[]): string | SegmentFailure {
  if (operands.length === 0) return os.homedir();
  if (operands.length > 1 || operands[0].isGlob || operands[0].raw === '-') {
    return { ok: false, reason: 'unresolvable', detail: 'cd target cannot be resolved' };
  }
  return operands[0].path;
}

export function normalize(command: string, cwd: string): NormalizeResult {
  const trimmed = command.trim();
  if (!trimmed) return { ok: false, reason: 'unresolvable', detail: 'empty command' };

  const unresolvable = hasUnresolvableSyntax(trimmed);
  if (unresolvable) return { ok: false, reason: 'unresolvable', detail: unresolvable };

  const segments = splitSegments(tokenize(trimmed));
  if (typeof segments === 'string') {
    return { ok: false, reason: 'unresolvable', detail: `unsupported operator ${segments}` };
  }

  const piped = trimmed.includes('|');
  const commands: ResolvedCommand[] = [];
  let cursor = cwd;

  for (const segment of segments) {
    const head = segment[0];
    if (typeof head !== 'string') {
      return { ok: false, reason: 'unresolvable', detail: 'command name is a glob' };
    }
    const program = path.basename(head);

    const rejected = rejectProgram(program, segment, piped);
    if (rejected) return rejected;

    const args = readArguments(segment, program, cursor);
    if ('ok' in args) return args;

    if (program === 'cd') {
      const moved = nextCwd(args.operands);
      if (typeof moved !== 'string') return moved;
      cursor = moved;
      continue;
    }

    commands.push({ program, flags: args.flags, operands: args.operands, cwd: cursor });
  }

  if (commands.length === 0) {
    return { ok: false, reason: 'unresolvable', detail: 'no command to run' };
  }
  return { ok: true, commands };
}
