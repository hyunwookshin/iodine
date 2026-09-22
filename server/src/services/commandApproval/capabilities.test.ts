import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lookupCapability } from './capabilities';
import { normalize } from './normalize';

let workspace: string;

beforeAll(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iodine-caps-')));
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

function look(command: string) {
  const result = normalize(command, workspace);
  if (!result.ok) throw new Error(`normalize failed: ${result.detail}`);
  return lookupCapability(result.commands[0]);
}

describe('subcommands', () => {
  it('separates a read from a network call on the same program', () => {
    expect(look('git status')).toMatchObject({ known: true, capability: { readsFiles: true, network: false } });
    expect(look('git push')).toMatchObject({ known: true, capability: { network: true } });
  });

  it('knows git clean deletes', () => {
    expect(look('git clean -fdx')).toMatchObject({ known: true, capability: { deletesFiles: true } });
  });

  it('does not guess at a subcommand it has never seen', () => {
    expect(look('git frobnicate')).toEqual({ known: false, subcommand: 'frobnicate' });
  });

  it('does not guess when a program that takes subcommands is given none', () => {
    expect(look('git')).toEqual({ known: false, subcommand: null });
  });

  it('treats yarn and pnpm like npm', () => {
    expect(look('yarn install')).toMatchObject({ known: true, capability: { network: true } });
    expect(look('pnpm ls')).toMatchObject({ known: true, capability: { readsFiles: true } });
  });
});

describe('programs whose real work is defined elsewhere', () => {
  it.each([['npm test'], ['npm run build'], ['make deploy'], ['node build.js'], ['find . -name x']])(
    'refuses to make %s approvable',
    command => {
      expect(look(command)).toMatchObject({ known: true, approvable: false });
    },
  );

  it('still allows commands that do their own work', () => {
    expect(look('rm -rf .build')).toMatchObject({ known: true, approvable: true });
  });
});

describe('unknown programs', () => {
  it('returns nothing for a binary it does not recognise', () => {
    expect(look('mysterytool --wipe')).toEqual({ known: false, subcommand: null });
  });
});

describe('capability shape', () => {
  it('marks rm as deleting but not writing', () => {
    expect(look('rm -rf .build')).toMatchObject({ capability: { deletesFiles: true, writesFiles: false } });
  });

  it('marks mv as both writing and deleting', () => {
    expect(look('mv a b')).toMatchObject({ capability: { writesFiles: true, deletesFiles: true } });
  });

  it('treats sed as a write because -i edits in place', () => {
    expect(look('sed s/a/b/ file.txt')).toMatchObject({ capability: { writesFiles: true } });
  });

  it('gives a pure read no write or network', () => {
    expect(look('cat README.md')).toMatchObject({
      capability: { readsFiles: true, writesFiles: false, deletesFiles: false, network: false },
    });
  });
});
