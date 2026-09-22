import { lookupCapability, type Capability } from './capabilities';
import { BLOCK_THRESHOLD, flagRisk } from './flags';
import { normalize } from './normalize';
import { classifyOperand, type OperandClass } from './operands';

export interface Signature {
  program: string;
  subcommand: string | null;
  flags: string[];
  capability: Capability;
  operandClasses: OperandClass[];
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

export function describeCommand(command: string, cwd: string, rootPath: string | null): DescribeResult {
  const normalized = normalize(command, cwd);
  if (!normalized.ok) return { ok: false, reason: normalized.detail };

  const parts = normalized.commands.map<CommandPart>(cmd => {
    const lookup = lookupCapability(cmd);
    const risk = flagRisk(cmd);
    const operandClasses = cmd.operands.map(o => classifyOperand(o, rootPath));

    const signature: Signature = {
      program: cmd.program,
      subcommand: lookup.subcommand,
      flags: cmd.flags,
      capability: lookup.known ? lookup.capability : ZERO_CAPABILITY,
      operandClasses,
    };
    const base = { signature, paths: cmd.operands.filter(o => !o.isGlob).map(o => o.path), flagWeight: risk.weight };

    if (!lookup.known) {
      return { ...base, approvable: false, reason: `unrecognised command ${cmd.program}` };
    }
    if (!lookup.approvable) {
      return { ...base, approvable: false, reason: `${cmd.program} runs code defined elsewhere` };
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
  return (
    a.program === b.program &&
    a.subcommand === b.subcommand &&
    a.flags.length === b.flags.length &&
    a.flags.every((flag, i) => flag === b.flags[i]) &&
    a.operandClasses.length === b.operandClasses.length &&
    a.operandClasses.every((cls, i) => cls === b.operandClasses[i]) &&
    (Object.keys(a.capability) as (keyof Capability)[]).every(key => a.capability[key] === b.capability[key])
  );
}
