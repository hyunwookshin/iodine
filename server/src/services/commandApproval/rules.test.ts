import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';
import { commonAncestor, deleteRule, findMatch, loadRules, saveRule } from './rules';
import { describeCommand, type CommandPart } from './signature';

let workspace: string;
let cacheDir: string;

beforeAll(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iodine-rules-')));
  fs.mkdirSync(path.join(workspace, 'src'));
  fs.mkdirSync(path.join(workspace, 'dist'));
  fs.writeFileSync(path.join(workspace, '.gitignore'), 'dist\n');
  execFileSync('git', ['init', '-q'], { cwd: workspace });

  const hash = crypto.createHash('md5').update(workspace).digest('hex');
  cacheDir = path.join(os.homedir(), '.iodine', hash);
});

beforeEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

function parts(command: string): CommandPart[] {
  const result = describeCommand(command, workspace, workspace);
  if (!result.ok) throw new Error(`describe failed: ${result.reason}`);
  return result.parts;
}

describe('commonAncestor', () => {
  it('returns the folder itself for a single target', () => {
    expect(commonAncestor(['/p/src'])).toBe('/p/src');
  });

  it('returns the shared parent for two targets', () => {
    expect(commonAncestor(['/p/src/a', '/p/src/b'])).toBe('/p/src');
  });

  it('does not treat a shared name prefix as a shared folder', () => {
    expect(commonAncestor(['/p/src', '/p/srcfoo'])).toBe('/p');
  });

  it('returns nothing when there are no targets', () => {
    expect(commonAncestor([])).toBeNull();
  });
});

describe('saving and loading', () => {
  it('stores a rule scoped to the folder that was approved', async () => {
    const rule = await saveRule(workspace, parts('rm -rf dist')[0]);
    expect(rule.pathPrefix).toBe(path.join(workspace, 'dist'));
    expect(await loadRules(workspace)).toHaveLength(1);
  });

  it('refuses to store something that was never approvable', async () => {
    await expect(saveRule(workspace, parts('rm -rf ~/')[0])).rejects.toThrow();
  });

  it('removes a rule by id', async () => {
    const rule = await saveRule(workspace, parts('ls src')[0]);
    expect(await deleteRule(workspace, rule.id)).toBe(true);
    expect(await loadRules(workspace)).toHaveLength(0);
  });

  it('treats a damaged file as no rules at all', async () => {
    await fs.promises.mkdir(cacheDir, { recursive: true });
    await fs.promises.writeFile(path.join(cacheDir, 'approval-rules.json'), '{not json', 'utf-8');
    expect(await loadRules(workspace)).toEqual([]);
  });
});

describe('matching', () => {
  it('matches the command that created the rule', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('ls src'))).toHaveLength(1);
  });

  it('matches a file beneath the approved folder', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('ls src/deep'))).toHaveLength(1);
  });

  it('does not match a sibling folder', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('ls dist'))).toBeNull();
  });

  it('does not match once a flag is added', async () => {
    await saveRule(workspace, parts('rm -rf dist')[0]);
    expect(await findMatch(workspace, parts('rm -r dist'))).toBeNull();
  });

  it('does not let a read rule cover a delete', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('rm -rf src'))).toBeNull();
  });

  it('does not match a hidden file inside the approved folder', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('ls src/.env'))).toBeNull();
  });

  it('does not reach a gitignored folder through an approved parent', async () => {
    await saveRule(workspace, parts('ls .')[0]);
    expect(await findMatch(workspace, parts('ls dist'))).toBeNull();
  });

  it('still allows a rule aimed straight at a gitignored folder', async () => {
    await saveRule(workspace, parts('rm -rf dist')[0]);
    expect(await findMatch(workspace, parts('rm -rf dist'))).toHaveLength(1);
  });

  it('returns nothing when there are no rules', async () => {
    expect(await findMatch(workspace, parts('ls src'))).toBeNull();
  });

  it('records when a rule was last used', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    await findMatch(workspace, parts('ls src'));
    expect((await loadRules(workspace))[0].lastUsedAt).not.toBeNull();
  });
});

describe('chains', () => {
  it('needs every part of the chain to be covered', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('ls src && rm -rf dist'))).toBeNull();
  });

  it('matches once both parts have a rule', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    await saveRule(workspace, parts('rm -rf dist')[0]);
    expect(await findMatch(workspace, parts('ls src && rm -rf dist'))).toHaveLength(2);
  });

  it('never matches a chain containing something unapprovable', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('ls src && npm test'))).toBeNull();
  });
});

describe('the pair this whole feature exists for', () => {
  it('does not let an approved project delete cover the home directory', async () => {
    await saveRule(workspace, parts('rm -rf dist')[0]);
    expect(await findMatch(workspace, parts('rm -rf ~/'))).toBeNull();
  });
});
