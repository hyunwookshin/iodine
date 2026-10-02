import type { ResolvedCommand } from './normalize';

export interface FlagRisk {
  weight: number;
  /** Nothing can make the command approvable, however narrow the rule. */
  blocked: boolean;
}

export const BLOCK_THRESHOLD = 50;

const BLOCKED = 100;

const RISK_WEIGHT: Record<string, number> = {
  '--force': 2,
  '--recursive': 2,
  '--no-preserve-root': BLOCKED,
};

const PROGRAM_RISK: Record<string, Record<string, number>> = {
  git: {
    '--hard': 3,
    '--force': 3,
    '--force-with-lease': 1,
    '-D': 3,
    '-d': 1,
    '-x': 2,
  },
  npm: {
    '--global': 3,
    '--force': 3,
  },
  rm: {
    '--dir': 1,
    '--interactive': -1,
  },
  chmod: {
    '--recursive': 3,
  },
  find: {
    '-exec': BLOCKED,
    '-execdir': BLOCKED,
    '-delete': 4,
  },
};

export function flagRisk(command: ResolvedCommand): FlagRisk {
  const overrides = PROGRAM_RISK[command.program] ?? {};
  let weight = 0;

  for (const flag of command.flags) {
    weight += overrides[flag] ?? RISK_WEIGHT[flag] ?? 0;
  }

  // An interactive prompt cannot lower risk below none.
  weight = Math.max(0, weight);
  return { weight, blocked: weight >= BLOCK_THRESHOLD };
}
