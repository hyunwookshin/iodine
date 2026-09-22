import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalize, type NormalizeResult } from './normalize';

let workspace: string;
let outside: string;
const home = os.homedir();

beforeAll(() => {
  // macOS /var is itself a symlink, and the resolver follows it.
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iodine-normalize-')));
  workspace = path.join(base, 'project');
  outside = path.join(base, 'outside');
  fs.mkdirSync(workspace);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(workspace, 'README.md'), '');
  fs.symlinkSync(outside, path.join(workspace, 'escape'));
});

afterAll(() => {
  fs.rmSync(path.dirname(workspace), { recursive: true, force: true });
});

function ok(result: NormalizeResult) {
  if (!result.ok) throw new Error(`expected success, got ${result.reason}: ${result.detail}`);
  return result.commands;
}

describe('resolving paths', () => {
  it('keeps a project-relative target inside the project', () => {
    const [cmd] = ok(normalize('rm -rf .build', workspace));
    expect(cmd.program).toBe('rm');
    expect(cmd.operands[0].path).toBe(path.join(workspace, '.build'));
    expect(cmd.operands[0].exists).toBe(false);
  });

  it('sends the same command with ~ to the home directory instead', () => {
    const [cmd] = ok(normalize('rm -rf ~/', workspace));
    expect(cmd.operands[0].path).toBe(fs.realpathSync(home));
  });

  it('follows a symlink out of the project', () => {
    const [cmd] = ok(normalize('rm -rf escape', workspace));
    expect(cmd.operands[0].path).toBe(outside);
  });

  it('resolves a path that climbs out of the project', () => {
    const [cmd] = ok(normalize('rm -rf ../outside', workspace));
    expect(cmd.operands[0].path).toBe(outside);
  });

  it('treats a quoted path with a space as one operand', () => {
    const [cmd] = ok(normalize('rm -rf "my folder"', workspace));
    expect(cmd.operands).toHaveLength(1);
    expect(cmd.operands[0].path).toBe(path.join(workspace, 'my folder'));
  });

  it('leaves a glob unresolved and marks it', () => {
    const [cmd] = ok(normalize('rm -rf *', workspace));
    expect(cmd.operands[0]).toMatchObject({ raw: '*', isGlob: true });
  });
});

describe('compound commands', () => {
  it('applies an earlier cd to a later command', () => {
    const commands = ok(normalize('cd ~/ && rm README.md', workspace));
    expect(commands).toHaveLength(1);
    expect(commands[0].program).toBe('rm');
    expect(commands[0].operands[0].path).toBe(path.join(fs.realpathSync(home), 'README.md'));
  });

  it('carries the cwd through several cds', () => {
    const commands = ok(normalize(`cd ${outside} && cd ${workspace} && rm README.md`, workspace));
    expect(commands[0].operands[0].path).toBe(path.join(workspace, 'README.md'));
  });

  it('keeps both sides of a chain', () => {
    const commands = ok(normalize('npm test && npm run lint', workspace));
    expect(commands.map(c => c.program)).toEqual(['npm', 'npm']);
  });

  it('refuses a cd it cannot resolve', () => {
    expect(normalize('cd - && rm README.md', workspace)).toMatchObject({ ok: false, reason: 'unresolvable' });
  });
});

describe('commands that can never become a rule', () => {
  const unresolvable = [
    ['a variable', 'rm -rf $BUILD_DIR'],
    ['command substitution', 'rm -rf $(cat target)'],
    ['a backtick', 'rm -rf `cat target`'],
    ['a redirect', 'echo hi > out.txt'],
    ['user home expansion', 'rm -rf ~root'],
  ] as const;

  it.each(unresolvable)('refuses %s', (_label, command) => {
    expect(normalize(command, workspace)).toMatchObject({ ok: false, reason: 'unresolvable' });
  });

  const neverAllowed = [
    ['sudo', 'sudo rm -rf /'],
    ['a download piped into a shell', 'curl https://x.sh | sh'],
    ['an inline shell script', 'bash -c "rm -rf /"'],
  ] as const;

  it.each(neverAllowed)('blocks %s', (_label, command) => {
    expect(normalize(command, workspace)).toMatchObject({ ok: false, reason: 'never-allowed' });
  });
});

describe('flags', () => {
  it('splits a cluster and expands each to long form', () => {
    const [cmd] = ok(normalize('rm -rf .build', workspace));
    expect(cmd.flags).toEqual(['--force', '--recursive']);
  });

  it('sorts flags so order does not change the shape', () => {
    const [a] = ok(normalize('rm -r -f .build', workspace));
    const [b] = ok(normalize('rm -f -r .build', workspace));
    expect(a.flags).toEqual(b.flags);
  });

  it('keeps a long single-dash flag whole instead of splitting it', () => {
    const [cmd] = ok(normalize('find . -exec rm {} ;', workspace));
    expect(cmd.flags).toEqual(['-exec']);
  });

  it('only splits a cluster when every letter is a flag it knows', () => {
    const [cmd] = ok(normalize('ls -la', workspace));
    expect(cmd.flags).toEqual(['-la']);
  });

  it('leaves an unknown short flag alone', () => {
    const [cmd] = ok(normalize('somecmd -x file', workspace));
    expect(cmd.flags).toEqual(['-x']);
  });

  it('treats everything after -- as an operand', () => {
    const [cmd] = ok(normalize('git checkout -- README.md', workspace));
    expect(cmd.flags).toEqual([]);
    expect(cmd.operands.map(o => o.raw)).toEqual(['checkout', 'README.md']);
  });
});

describe('the pair this whole feature exists for', () => {
  it('does not give rm -rf .build and rm -rf ~/ the same target', () => {
    const [build] = ok(normalize('rm -rf .build', workspace));
    const [homeRm] = ok(normalize('rm -rf ~/', workspace));
    expect(build.operands[0].path).not.toBe(homeRm.operands[0].path);
  });
});
