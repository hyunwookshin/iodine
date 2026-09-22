import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalize } from './normalize';
import { classifyOperand, coveredByPrefix, isUnder, type OperandClass } from './operands';

let workspace: string;
let outside: string;

beforeAll(() => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iodine-operands-')));
  workspace = path.join(base, 'project');
  outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(workspace, 'escape'));
});

afterAll(() => {
  fs.rmSync(path.dirname(workspace), { recursive: true, force: true });
});

function classify(command: string): OperandClass[] {
  const result = normalize(command, workspace);
  if (!result.ok) throw new Error(`normalize failed: ${result.detail}`);
  return result.commands[0].operands.map(o => classifyOperand(o, workspace));
}

describe('where a path lands', () => {
  it.each<[string, OperandClass]>([
    ['rm -rf .build', 'inside-project'],
    ['rm -rf src', 'inside-project'],
    ['rm -rf ~/', 'home'],
    ['rm -rf /', 'root'],
    ['rm -rf /etc/hosts', 'system'],
    ['rm -rf ../outside', 'outside'],
    ['rm -rf *', 'glob'],
    ['git clone https://example.com/x.git', 'url'],
  ])('puts %s in %s', (command, expected) => {
    expect(classify(command)).toContain(expected);
  });

  it('sends a symlink out of the project to where it actually points', () => {
    expect(classify('rm -rf escape')).toEqual(['outside']);
  });

  it('does not treat the project as inside itself when no workspace is open', () => {
    const result = normalize('rm -rf src', workspace);
    if (!result.ok) throw new Error('normalize failed');
    expect(classifyOperand(result.commands[0].operands[0], null)).toBe('outside');
  });
});

describe('isUnder', () => {
  it('matches a real child', () => {
    expect(isUnder('/a/b/c', '/a/b')).toBe(true);
  });

  it('matches the folder itself', () => {
    expect(isUnder('/a/b', '/a/b')).toBe(true);
  });

  it('does not match a sibling with a shared name prefix', () => {
    expect(isUnder('/a/bc', '/a/b')).toBe(false);
  });

  it('does not match a parent', () => {
    expect(isUnder('/a', '/a/b')).toBe(false);
  });
});

describe('what an approved folder covers', () => {
  it('covers a file beneath it', () => {
    expect(coveredByPrefix('/p/src/index.ts', '/p')).toBe(true);
  });

  it('does not cover a sibling folder', () => {
    expect(coveredByPrefix('/p2/index.ts', '/p')).toBe(false);
  });

  it('does not cover a hidden file', () => {
    expect(coveredByPrefix('/p/.env', '/p')).toBe(false);
  });

  it('does not cover anything inside a hidden folder', () => {
    expect(coveredByPrefix('/p/.git/config', '/p')).toBe(false);
  });

  it('still covers a normal file when the approved folder is itself hidden', () => {
    expect(coveredByPrefix('/p/.cache/thing', '/p/.cache')).toBe(true);
  });
});

describe('the pair this whole feature exists for', () => {
  it('does not put rm -rf .build and rm -rf ~/ in the same class', () => {
    expect(classify('rm -rf .build')).not.toEqual(classify('rm -rf ~/'));
  });

  it('does not let an approved project folder cover the home directory', () => {
    expect(coveredByPrefix(os.homedir(), workspace)).toBe(false);
  });
});
