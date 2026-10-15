import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeCommand, sameSignature, type CommandPart } from './signature';

let workspace: string;

beforeAll(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iodine-signature-')));
  fs.mkdirSync(path.join(workspace, 'src'));
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

function parts(command: string): CommandPart[] {
  const result = describeCommand(command, workspace, workspace);
  if (!result.ok) throw new Error(`describe failed: ${result.reason}`);
  return result.parts;
}

function only(command: string): CommandPart {
  const all = parts(command);
  expect(all).toHaveLength(1);
  return all[0];
}

describe('what can become a rule', () => {
  it('allows a delete inside the project', () => {
    expect(only('rm -f src/file.txt')).toMatchObject({ approvable: true, reason: null });
  });

  it('refuses the same delete aimed at home', () => {
    expect(only('rm -f ~/')).toMatchObject({ approvable: false, reason: 'a target is home, not inside the project' });
  });

  it('refuses a command whose work is defined elsewhere', () => {
    expect(only('npm test').approvable).toBe(false);
  });

  it('refuses a program it does not recognise', () => {
    expect(only('mysterytool src').approvable).toBe(false);
  });

  it('refuses a blocked flag', () => {
    expect(only('rm --no-preserve-root src').approvable).toBe(false);
  });

  it('refuses recursive deletion and git clean', () => {
    expect(only('rm -rf src').approvable).toBe(false);
    expect(only('rm -r src').approvable).toBe(false);
    expect(only('rm -rfP src').approvable).toBe(false);
    expect(only('git clean -fdx').approvable).toBe(false);
  });

  it('refuses Git commands whose effects depend on a remote', () => {
    expect(only('git push origin main').approvable).toBe(false);
    expect(only('git pull origin main').approvable).toBe(false);
  });

  it('keeps chmod modes exact and refuses recursive flags', () => {
    expect(only('chmod 777 src').approvable).toBe(true);
    expect(sameSignature(only('chmod 777 src').signature, only('chmod 000 src').signature)).toBe(false);
    expect(only('chmod -R 777 src').approvable).toBe(false);
  });

  it('refuses flags that hide a write target', () => {
    expect(only('cp --target-directory=/tmp src/file').approvable).toBe(false);
    expect(only('mv --target-directory=/tmp src/file').approvable).toBe(false);
    expect(only('git diff --output=/tmp/diff').approvable).toBe(false);
  });

  it('refuses a glob, since we cannot tell what it hits', () => {
    expect(only('rm -rf *').approvable).toBe(false);
    expect(only('git show *').approvable).toBe(false);
  });

  it('refuses a command that cannot be resolved at all', () => {
    expect(describeCommand('rm -rf $DIR', workspace, workspace)).toMatchObject({ ok: false });
  });
});

describe('chains', () => {
  it('describes each command separately', () => {
    const chain = parts('ls src && rm -rf .build');
    expect(chain.map(p => p.signature.program)).toEqual(['ls', 'rm']);
  });

  it('marks only the part that cannot be approved', () => {
    const chain = parts('ls src && npm test');
    expect(chain.map(p => p.approvable)).toEqual([true, false]);
  });
});

describe('two commands count as the same shape', () => {
  it('when only the target folder differs', () => {
    expect(sameSignature(only('rm -rf .build').signature, only('rm -rf src').signature)).toBe(true);
  });

  it('but not when a flag differs', () => {
    expect(sameSignature(only('rm -rf .build').signature, only('rm -r .build').signature)).toBe(false);
  });

  it('and not when the subcommand differs', () => {
    const status = only('git status').signature;
    const add = only('git add src').signature;
    expect(sameSignature(status, add)).toBe(false);
  });

  it('and not when the target moves outside the project', () => {
    const inside = only('rm -rf .build').signature;
    const away = only('rm -rf ~/').signature;
    expect(sameSignature(inside, away)).toBe(false);
  });
});
