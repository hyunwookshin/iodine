import { lookupCapability, type Capability } from './capabilities';
import { BLOCK_THRESHOLD, flagRisk } from './flags';
import { normalize, type ResolvedCommand, type ResolvedOperand } from './normalize';
import { classifyOperand, type OperandClass } from './operands';

export interface Signature {
  program: string;
  subcommand: string | null;
  flags: string[];
  capability: Capability;
  operandClasses: OperandClass[];
  literalOperands: string[];
}

export interface CommandPart {
  signature: Signature;
  /** Resolved operand paths, used to scope a rule to a folder. */
  paths: string[];
  flagWeight: number;
  /** A part that cannot be saved as a rule still runs; it just always asks. */
  approvable: boolean;
  reason: string | null;
}

export type DescribeResult =
  | { ok: true; parts: CommandPart[] }
  | { ok: false; reason: string };

const ZERO_CAPABILITY: Capability = {
  readsFiles: false,
  writesFiles: false,
  deletesFiles: false,
  network: false,
  spawnsProcesses: false,
  changesSystem: false,
};

/** Anything pointing outside the project has to be approved every time. */
const APPROVABLE_CLASSES = new Set<OperandClass>(['inside-project']);
const APPROVABLE_RM_FLAGS = new Set(['--force', '--interactive', '--verbose', '--dir']);
const ALL_LITERAL_PROGRAMS = new Set(['echo', 'printf', 'date', 'which', 'npm', 'yarn', 'pnpm']);
const FIRST_LITERAL_PROGRAMS = new Set(['chmod', 'chown']);
const APPROVABLE_GIT_SUBCOMMANDS = new Set(['status', 'log', 'diff', 'show', 'blame']);
const UNKNOWN_OPERAND_PROGRAMS = new Set(['grep', 'rg', 'sed', 'cut', 'sort', 'uniq', 'ping', 'curl', 'wget', 'kill']);
const APPROVABLE_WRITE_FLAGS: Record<string, Set<string>> = {
  cp: new Set(['--recursive', '--force', '--interactive', '--verbose']),
  mv: new Set(['--force', '--interactive', '--no-clobber', '--verbose']),
  mkdir: new Set(['--parents', '--verbose']),
  ln: new Set(),
  tee: new Set(),
  touch: new Set(),
  rmdir: new Set(),
};

function splitOperands(cmd: ResolvedCommand, subcommand: string | null): { paths: ResolvedOperand[]; literals: string[] } {
  if (cmd.program === 'git' || ALL_LITERAL_PROGRAMS.has(cmd.program)) {
    return { paths: [], literals: cmd.operands.slice(subcommand ? 1 : 0).map(operand => operand.raw) };
  }
  if (FIRST_LITERAL_PROGRAMS.has(cmd.program)) {
    return { paths: cmd.operands.slice(1), literals: cmd.operands.slice(0, 1).map(operand => operand.raw) };
  }
  return { paths: cmd.operands, literals: [] };
}

export function describeCommand(command: string, cwd: string, rootPath: string | null): DescribeResult {
  const normalized = normalize(command, cwd);
  if (!normalized.ok) return { ok: false, reason: normalized.detail };

  const parts = normalized.commands.map<CommandPart>(cmd => {
    const lookup = lookupCapability(cmd);
    const risk = flagRisk(cmd);
    const { paths, literals } = splitOperands(cmd, lookup.subcommand);
    const operandClasses = paths.map(o => classifyOperand(o, rootPath));

    const signature: Signature = {
      program: cmd.program,
      subcommand: lookup.subcommand,
      flags: cmd.flags,
      capability: lookup.known ? lookup.capability : ZERO_CAPABILITY,
      operandClasses,
      literalOperands: literals,
    };
    const base = { signature, paths: paths.filter(o => !o.isGlob).map(o => o.path), flagWeight: risk.weight };

    if (!lookup.known) {
      return { ...base, approvable: false, reason: `unrecognised command ${cmd.program}` };
    }
    if (!lookup.approvable) {
      return { ...base, approvable: false, reason: `${cmd.program} runs code defined elsewhere` };
    }
    if (cmd.operands.some(operand => operand.isGlob || classifyOperand(operand, rootPath) === 'url')) {
      return { ...base, approvable: false, reason: 'a glob or URL cannot be scoped to the project' };
    }
    if (UNKNOWN_OPERAND_PROGRAMS.has(cmd.program)) {
      return { ...base, approvable: false, reason: `${cmd.program} has arguments whose targets cannot be resolved` };
    }
    if (cmd.program === 'git' && (!lookup.subcommand || !APPROVABLE_GIT_SUBCOMMANDS.has(lookup.subcommand))) {
      return { ...base, approvable: false, reason: 'git command effects depend on repository state or remote configuration' };
    }
    if (cmd.program === 'git' && cmd.flags.length > 0) {
      return { ...base, approvable: false, reason: 'git flags can change where output is written' };
    }
    if (FIRST_LITERAL_PROGRAMS.has(cmd.program) && literals.length !== 1) {
      return { ...base, approvable: false, reason: `${cmd.program} requires a mode or owner` };
    }
    if (FIRST_LITERAL_PROGRAMS.has(cmd.program) && cmd.flags.length > 0) {
      return { ...base, approvable: false, reason: `${cmd.program} flags can affect unlisted files` };
    }
    if (cmd.program === 'rm') {
      if (cmd.flags.includes('--recursive')) {
        return { ...base, approvable: false, reason: 'recursive deletion can reach unlisted files' };
      }
      if (cmd.flags.some(flag => !APPROVABLE_RM_FLAGS.has(flag))) {
        return { ...base, approvable: false, reason: 'rm has an unrecognised flag' };
      }
    }
    const allowedWriteFlags = APPROVABLE_WRITE_FLAGS[cmd.program];
    if (allowedWriteFlags && cmd.flags.some(flag => !allowedWriteFlags.has(flag))) {
      return { ...base, approvable: false, reason: `${cmd.program} has an unrecognised flag` };
    }
    if (risk.blocked) {
      return { ...base, approvable: false, reason: `flags score ${risk.weight}, over the limit of ${BLOCK_THRESHOLD}` };
    }
    const offending = operandClasses.find(c => !APPROVABLE_CLASSES.has(c));
    if (offending) {
      return { ...base, approvable: false, reason: `a target is ${offending}, not inside the project` };
    }
    return { ...base, approvable: true, reason: null };
  });

  return { ok: true, parts };
}

export function sameSignature(a: Signature, b: Signature): boolean {
  const aLiterals = a.literalOperands ?? [];
  const bLiterals = b.literalOperands ?? [];
  return (
    a.program === b.program &&
    a.subcommand === b.subcommand &&
    a.flags.length === b.flags.length &&
    a.flags.every((flag, i) => flag === b.flags[i]) &&
    a.operandClasses.length === b.operandClasses.length &&
    a.operandClasses.every((cls, i) => cls === b.operandClasses[i]) &&
    aLiterals.length === bLiterals.length &&
    aLiterals.every((literal, i) => literal === bLiterals[i]) &&
    (Object.keys(a.capability) as (keyof Capability)[]).every(key => a.capability[key] === b.capability[key])
  );
}
