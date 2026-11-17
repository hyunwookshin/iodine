import { describe, expect, it } from 'vitest';
import { diffRows } from './editDiff';

describe('diffRows', () => {
  it('keeps the last line unchanged when lines are appended to a snippet without a trailing newline', () => {
    expect(diffRows('a\nb', 'a\nb\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'add', text: 'c' },
    ]);
  });

  it('keeps the last remaining line unchanged when trailing lines are removed', () => {
    expect(diffRows('a\nb\nc', 'a\nb')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'del', text: 'c' },
    ]);
  });

  it('gives the same rows whether or not the snippets end in a newline', () => {
    expect(diffRows('a\nb\n', 'a\nb\nc\n')).toEqual(diffRows('a\nb', 'a\nb\nc'));
    expect(diffRows('a\nb', 'a\nb\nc\n')).toEqual(diffRows('a\nb', 'a\nb\nc'));
  });

  it('shows a modified line as a removal followed by an addition', () => {
    expect(diffRows('a\nb\nc', 'a\nx\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('preserves blank lines inside a snippet', () => {
    expect(diffRows('a\n\nb', 'a\n\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: '' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'c' },
    ]);
  });

  it('returns no rows for identical empty snippets', () => {
    expect(diffRows('', '')).toEqual([]);
  });

  it('marks every line as added when the old snippet is empty', () => {
    expect(diffRows('', 'a\nb')).toEqual([
      { kind: 'add', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
  });
});
