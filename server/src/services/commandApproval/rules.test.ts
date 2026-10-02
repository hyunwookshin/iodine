import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';
import { commonAncestor, deleteRule, findMatch, findSimilarRule, loadRules, saveRule, updateRuleEmbedding } from './rules';
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
    const rule = await saveRule(workspace, parts('ls dist')[0]);
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

  it('keeps a new rule when an older rule receives its embedding', async () => {
    const first = await saveRule(workspace, parts('ls src')[0]);
    await Promise.all([
      updateRuleEmbedding(workspace, first.id, [1, 0]),
      saveRule(workspace, parts('ls dist')[0]),
    ]);
    const rules = await loadRules(workspace);
    expect(rules).toHaveLength(2);
    expect(rules.find(rule => rule.id === first.id)?.embedding).toEqual([1, 0]);
  });
});

describe('matching', () => {
  it('matches the command that created the rule', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('ls src'))).toHaveLength(1);
  });

  it('matches a file beneath the approved folder', async () => {
    await saveRule(workspace, parts('ls src')[0], null, 'directory');
    expect(await findMatch(workspace, parts('ls src/deep'))).toHaveLength(1);
  });

  it('does not extend an exact directory approval to its children', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('ls src'))).toHaveLength(1);
    expect(await findMatch(workspace, parts('ls src/deep'))).toBeNull();
  });

  it('treats an older rule without path scopes as exact', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    const file = path.join(cacheDir, 'approval-rules.json');
    const rules = JSON.parse(fs.readFileSync(file, 'utf-8'));
    delete rules[0].pathScopes;
    fs.writeFileSync(file, JSON.stringify(rules));
    expect(await findMatch(workspace, parts('ls src'))).toHaveLength(1);
    expect(await findMatch(workspace, parts('ls src/deep'))).toBeNull();
  });

  it('does not match a sibling folder', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('ls dist'))).toBeNull();
  });

  it('keeps a file approval exact even if a child path later appears', async () => {
    await saveRule(workspace, parts('rm -f src/file')[0]);
    expect(await findMatch(workspace, parts('rm -f src/file'))).toHaveLength(1);
    expect(await findMatch(workspace, parts('rm -f src/file/child'))).toBeNull();
  });

  it('checks each operand of a copy separately', async () => {
    await saveRule(workspace, parts('cp src/a src/b')[0]);
    expect(await findMatch(workspace, parts('cp src/a src/b'))).toHaveLength(1);
    expect(await findMatch(workspace, parts('cp src/a src/c'))).toBeNull();
    expect(await findMatch(workspace, parts('cp src/b src/a'))).toBeNull();
  });

  it('lets a newly created directory cover its visible children', async () => {
    await saveRule(workspace, parts('mkdir src/new')[0], null, 'directory');
    expect(await findMatch(workspace, parts('mkdir src/new/child'))).toHaveLength(1);
    expect(await findMatch(workspace, parts('mkdir src/new-sibling'))).toBeNull();
    expect(await findMatch(workspace, parts('mkdir src/new/.secret'))).toBeNull();
  });

  it('does not match once a flag is added', async () => {
    await saveRule(workspace, parts('rm dist/file')[0]);
    expect(await findMatch(workspace, parts('rm -f dist/file'))).toBeNull();
  });

  it('does not let a read rule cover a delete', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('rm -f src/file'))).toBeNull();
  });

  it('does not match a hidden file inside the approved folder', async () => {
    await saveRule(workspace, parts('ls src')[0], null, 'directory');
    expect(await findMatch(workspace, parts('ls src/.env'))).toBeNull();
  });

  it('does not reach a gitignored folder through an approved parent', async () => {
    await saveRule(workspace, parts('ls .')[0], null, 'directory');
    expect(await findMatch(workspace, parts('ls dist'))).toBeNull();
  });

  it('still allows a rule aimed straight at a gitignored folder', async () => {
    await saveRule(workspace, parts('ls dist')[0]);
    expect(await findMatch(workspace, parts('ls dist'))).toHaveLength(1);
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

describe('similar approval suggestions', () => {
  it('stores an embedding and suggests a similar command without matching its rule', async () => {
    await saveRule(workspace, parts('ls src')[0], [1, 0]);
    expect(await findMatch(workspace, parts('ls dist'))).toBeNull();
    expect(await findSimilarRule(workspace, parts('ls dist')[0], [0.99, 0.1])).toMatchObject({ program: 'ls' });
  });

  it('does not suggest a different program or a distant vector', async () => {
    await saveRule(workspace, parts('ls src')[0], [1, 0]);
    expect(await findSimilarRule(workspace, parts('rm -f src/file')[0], [1, 0])).toBeNull();
    expect(await findSimilarRule(workspace, parts('ls dist')[0], [0, 1])).toBeNull();
  });
});

describe('chains', () => {
  it('needs every part of the chain to be covered', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('ls src && rm -f dist/file'))).toBeNull();
  });

  it('matches once both parts have a rule', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    await saveRule(workspace, parts('rm -f dist/file')[0]);
    expect(await findMatch(workspace, parts('ls src && rm -f dist/file'))).toHaveLength(2);
  });

  it('never matches a chain containing something unapprovable', async () => {
    await saveRule(workspace, parts('ls src')[0]);
    expect(await findMatch(workspace, parts('ls src && npm test'))).toBeNull();
  });
});

describe('the pair this whole feature exists for', () => {
  it('does not let an approved project delete cover the home directory', async () => {
    await saveRule(workspace, parts('rm -f dist/file')[0]);
    expect(await findMatch(workspace, parts('rm -f ~/'))).toBeNull();
  });
});
