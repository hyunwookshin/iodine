import { describe, expect, it } from 'vitest';
import { isNonPortableArchiveEntry } from './project';

describe('metadata archive entries', () => {
  it.each([
    'approval-rules.json',
    './approval-rules.json',
    '././approval-log.jsonl',
    'nested/approval-rules.json',
    'Approval-Rules.json',
  ])('refuses local approval data at %s', entry => {
    expect(isNonPortableArchiveEntry(entry)).toBe(true);
  });

  it('keeps regular metadata portable', () => {
    expect(isNonPortableArchiveEntry('./summary.md')).toBe(false);
  });
});
