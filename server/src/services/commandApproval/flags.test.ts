import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flagRisk } from './flags';
import { normalize } from './normalize';

let workspace: string;

beforeAll(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iodine-flags-')));
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

function risk(command: string) {
  const result = normalize(command, workspace);
  if (!result.ok) throw new Error(`normalize failed: ${result.detail}`);
  return flagRisk(result.commands[0]);
}

describe('weighting', () => {
  it('gives a plain read no risk', () => {
    expect(risk('ls src')).toEqual({ weight: 0, blocked: false });
  });

  it('adds up force and recursive', () => {
    expect(risk('rm -rf .build').weight).toBe(4);
  });

  it('does not care what order the flags came in', () => {
    expect(risk('rm -r -f .build').weight).toBe(risk('rm -f -r .build').weight);
  });

  it('ignores a flag it has never seen', () => {
    expect(risk('ls --colour-me-surprised').weight).toBe(0);
  });
});

describe('per-program differences', () => {
  it('rates git --force above the generic value', () => {
    expect(risk('git push --force').weight).toBe(3);
  });

  it('rates --force-with-lease below a bare --force', () => {
    expect(risk('git push --force-with-lease').weight).toBeLessThan(risk('git push --force').weight);
  });

  it('rates a global npm install above a local one', () => {
    expect(risk('npm install -g typescript').weight).toBeGreaterThan(risk('npm install typescript').weight);
  });
});

describe('flags nothing can approve', () => {
  it.each([['rm --no-preserve-root /'], ['find . -exec rm {} ;']])('blocks %s', command => {
    expect(risk(command).blocked).toBe(true);
  });

  it('does not block an ordinary dangerous-looking command', () => {
    expect(risk('rm -rf .build').blocked).toBe(false);
  });
});

describe('interactive flags', () => {
  it('never drops the weight below zero', () => {
    expect(risk('rm -i README.md').weight).toBe(0);
  });
});
