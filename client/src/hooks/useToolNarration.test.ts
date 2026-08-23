// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toolNarrationInternals as narration, useToolNarration } from './useToolNarration';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
});

describe('tool narration rules', () => {
  it('detects exact question bridge phrases case-insensitively', () => {
    expect(narration.isBridgeQuestion('How does this work?')).toBe(true);
    expect(narration.isBridgeQuestion('WHY IS that needed?')).toBe(true);
    expect(narration.isBridgeQuestion('When should this run?')).toBe(true);
    expect(narration.isBridgeQuestion('When can this run?')).toBe(true);
    expect(narration.isBridgeQuestion('What if it fails?')).toBe(true);
    expect(narration.isBridgeQuestion('How does this work')).toBe(false);
    expect(narration.isBridgeQuestion('How exactly does this work?')).toBe(false);
    expect(narration.isBridgeQuestion('Where is this?')).toBe(true);
  });

  it('queues a bridge only when a matching question is followed by a tool narration', () => {
    const { result } = renderHook(() => useToolNarration('openai'));

    act(() => result.current.setBridgeQuestion('Why is this needed?'));
    expect(result.current.queueRef.current).toHaveLength(0);

    act(() => result.current.narrate('read_file', { path: 'src/App.ts' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.queueRef.current).toHaveLength(1);
  });

  it('alternates file type inclusion', () => {
    expect(narration.describeFile('src/App.tsx', 0)).toBe('App file');
    expect(narration.describeFile('src/App.tsx', 1)).toBe('App TypeScript file');
  });

  it('describes list_directory targets as directories', () => {
    expect(narration.describeTarget('list_directory', 'src/hooks', 0)).toBe('hooks directory');
    expect(narration.describeTarget('read_file', 'src/App.tsx', 0)).toBe('App file');
  });

  it('marks only exploration tools as skippable', () => {
    expect(narration.skippableTools.has('read_file')).toBe(true);
    expect(narration.skippableTools.has('open_file')).toBe(true);
    expect(narration.skippableTools.has('edit_file')).toBe(false);
    expect(narration.skippableTools.has('write_file')).toBe(false);
  });

  it('continues adjacent read/open calls with And', () => {
    expect(narration.getFamily('read_file')).toBe('read');
    expect(narration.getFamily('open_file')).toBe('read');
    expect(narration.formatPhrase('Let me read {file}.', 'App file', true))
      .toBe('And App file.');
  });

  it('handles known, unknown, compound, and missing extensions', () => {
    expect(narration.getFileParts('src/App.TSX')).toEqual({
      filename: 'App.TSX', extension: 'tsx', displayName: 'App',
    });
    expect(narration.getFileParts('archive.test.ts').displayName).toBe('archive.test');
    expect(narration.getFileType('tsx')).toBe('TypeScript');
    expect(narration.getFileType('rs')).toBe('RS');
    expect(narration.getFileType(null)).toBeNull();
  });

  it('avoids implementation wording for non-code files', () => {
    const nonCodeExtensions = [
      'md', 'mdx', 'rst', 'adoc', 'txt', 'log',
      'html', 'htm', 'svg',
      'json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'conf', 'csv', 'tsv', 'lock',
    ];
    for (const extension of nonCodeExtensions) {
      expect(narration.getPhrases('read_file', extension))
        .not.toEqual(expect.arrayContaining([expect.stringMatching(/code|implementation|logic/i)]));
    }
    expect(narration.getPhrases('read_file', 'ts'))
      .toEqual(expect.arrayContaining([expect.stringMatching(/implementation/i)]));
  });

  it('deduplicates read/open calls after normalizing path separators', () => {
    const { result } = renderHook(() => useToolNarration('openai'));

    act(() => {
      result.current.narrate('read_file', { path: './src/App.ts' });
      result.current.narrate('open_file', { path: 'src\\App.ts' });
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rotates repeat wording across turns', async () => {
    const { result } = renderHook(() => useToolNarration('openai'));
    const path = 'src/App.ts';

    act(() => result.current.narrate('read_file', { path }));
    for (let turn = 0; turn < 3; turn++) {
      act(() => {
        result.current.resetTurn();
        result.current.narrate('read_file', { path });
      });
    }

    const texts = [];
    for (const entry of result.current.queueRef.current) {
      void entry.fn();
      const options = vi.mocked(fetch).mock.calls.at(-1)?.[1] as RequestInit;
      texts.push(JSON.parse(options.body as string).text);
    }

    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain('again');
    expect(texts[1]).toContain('once more');
    expect(texts[2]).toContain('more closely');
  });

  it('evicts pending skippable narration but retains edits', () => {
    const { result } = renderHook(() => useToolNarration('openai'));

    act(() => {
      result.current.narrate('read_file', { path: 'src/App.ts' });
      result.current.narrate('search_files', { path: 'src/hooks' });
      result.current.narrate('edit_file', { path: 'src/App.ts' });
      result.current.evictSkippable();
    });

    expect(result.current.queueRef.current).toHaveLength(1);
    expect(result.current.queueRef.current[0].skippable).toBe(false);
  });
});
