import type { ResolvedCommand } from './normalize';

export interface Capability {
  readsFiles: boolean;
  writesFiles: boolean;
  deletesFiles: boolean;
  network: boolean;
  spawnsProcesses: boolean;
  changesSystem: boolean;
}

export type CapabilityLookup =
  | {
      known: true;
      subcommand: string | null;
      capability: Capability;
      /** False when the real work lives outside the command, e.g. a package.json script. */
      approvable: boolean;
    }
  | { known: false; subcommand: string | null };

const NONE: Capability = {
  readsFiles: false,
  writesFiles: false,
  deletesFiles: false,
  network: false,
  spawnsProcesses: false,
  changesSystem: false,
};

function cap(...on: (keyof Capability)[]): Capability {
  const result = { ...NONE };
  for (const key of on) result[key] = true;
  return result;
}

const READ = cap('readsFiles');
const WRITE = cap('readsFiles', 'writesFiles');
const DELETE = cap('readsFiles', 'deletesFiles');
const MOVE = cap('readsFiles', 'writesFiles', 'deletesFiles');
const NET = cap('network');
const NET_WRITE = cap('readsFiles', 'writesFiles', 'network');
const RUN = cap('readsFiles', 'writesFiles', 'spawnsProcesses');

interface ProgramEntry {
  capability?: Capability;
  approvable?: boolean;
  /** When present, the first operand names the subcommand. */
  subcommands?: Record<string, ProgramEntry>;
}

/** The real action is decided by a script or an argument we cannot see, so it can never become a rule. */
const WRAPPER: ProgramEntry = { capability: RUN, approvable: false };

const PACKAGE_MANAGER: ProgramEntry = {
  subcommands: {
    ls: { capability: READ },
    view: { capability: NET },
    install: { capability: NET_WRITE },
    ci: { capability: NET_WRITE },
    test: WRAPPER,
    start: WRAPPER,
    run: WRAPPER,
    exec: WRAPPER,
  },
};

const PROGRAMS: Record<string, ProgramEntry> = {
  ls: { capability: READ },
  cat: { capability: READ },
  head: { capability: READ },
  tail: { capability: READ },
  wc: { capability: READ },
  file: { capability: READ },
  stat: { capability: READ },
  du: { capability: READ },
  df: { capability: READ },
  tree: { capability: READ },
  diff: { capability: READ },
  grep: { capability: READ },
  rg: { capability: READ },
  sort: { capability: READ },
  uniq: { capability: READ },
  cut: { capability: READ },
  realpath: { capability: READ },
  basename: { capability: NONE },
  dirname: { capability: NONE },
  pwd: { capability: NONE },
  echo: { capability: NONE },
  printf: { capability: NONE },
  date: { capability: NONE },
  whoami: { capability: NONE },
  hostname: { capability: NONE },
  uname: { capability: NONE },
  which: { capability: NONE },

  touch: { capability: WRITE },
  mkdir: { capability: WRITE },
  cp: { capability: WRITE },
  ln: { capability: WRITE },
  tee: { capability: WRITE },
  // sed -i edits in place, so every use is treated as a write.
  sed: { capability: WRITE },

  mv: { capability: MOVE },
  rm: { capability: DELETE },
  rmdir: { capability: DELETE },

  ping: { capability: NET },
  curl: { capability: NET_WRITE },
  wget: { capability: NET_WRITE },

  chmod: { capability: cap('changesSystem') },
  chown: { capability: cap('changesSystem') },
  kill: { capability: cap('changesSystem') },

  find: WRAPPER,
  xargs: WRAPPER,
  env: WRAPPER,
  nohup: WRAPPER,
  time: WRAPPER,
  watch: WRAPPER,
  make: WRAPPER,
  node: WRAPPER,
  python: WRAPPER,
  python3: WRAPPER,
  npx: WRAPPER,
  docker: WRAPPER,
  ssh: WRAPPER,

  git: {
    subcommands: {
      status: { capability: READ },
      log: { capability: READ },
      diff: { capability: READ },
      show: { capability: READ },
      branch: { capability: READ },
      blame: { capability: READ },
      add: { capability: WRITE },
      commit: { capability: WRITE },
      stash: { capability: MOVE },
      checkout: { capability: MOVE },
      switch: { capability: MOVE },
      restore: { capability: MOVE },
      reset: { capability: MOVE },
      clean: { capability: DELETE },
      fetch: { capability: NET },
      pull: { capability: NET_WRITE },
      push: { capability: NET },
      clone: { capability: NET_WRITE },
    },
  },

  npm: PACKAGE_MANAGER,
  yarn: PACKAGE_MANAGER,
  pnpm: PACKAGE_MANAGER,
};

export function lookupCapability(command: ResolvedCommand): CapabilityLookup {
  const entry = PROGRAMS[command.program];
  if (!entry) return { known: false, subcommand: null };

  if (!entry.subcommands) {
    return {
      known: true,
      subcommand: null,
      capability: entry.capability ?? NONE,
      approvable: entry.approvable ?? true,
    };
  }

  const name = command.operands.find(o => !o.isGlob)?.raw ?? null;
  const sub = name ? entry.subcommands[name] : undefined;
  // An unrecognised subcommand tells us nothing about what the command does.
  if (!sub) return { known: false, subcommand: name };

  return {
    known: true,
    subcommand: name,
    capability: sub.capability ?? NONE,
    approvable: sub.approvable ?? true,
  };
}
