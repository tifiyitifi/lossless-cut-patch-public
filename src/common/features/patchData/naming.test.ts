// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { appendNameSuffix, formatEpochMsForFileName, getPatchCutTemplate, namingPresets, resolveMergeFileName } from './naming.js';

/* eslint-disable no-template-curly-in-string -- the templates are the subject of these tests. */

describe('getPatchCutTemplate', () => {
  it('keeps the upstream template for the default preset', () => {
    expect(getPatchCutTemplate('losslesscut', 'UPSTREAM')).toBe('UPSTREAM');
  });

  it('keeps the upstream template when no preset is configured', () => {
    expect(getPatchCutTemplate(undefined, 'UPSTREAM')).toBe('UPSTREAM');
  });

  it('applies the legacy preset template', () => {
    expect(getPatchCutTemplate('legacy', 'UPSTREAM')).toBe(namingPresets.legacy.cutTemplate);
  });

  it('the legacy template keeps the old clip_ prefix', () => {
    expect(getPatchCutTemplate('legacy', 'UPSTREAM')).toContain('clip_');
  });
});

describe('formatEpochMsForFileName', () => {
  it('writes the local time with millisecond precision', () => {
    expect(formatEpochMsForFileName(new Date(2026, 9, 26, 18, 1, 6, 19).getTime())).toBe('2026-10-26--18_01_06.019');
  });

  it('pads every field', () => {
    expect(formatEpochMsForFileName(new Date(2026, 0, 2, 3, 4, 5, 6).getTime())).toBe('2026-01-02--03_04_05.006');
  });
});

describe('resolveMergeFileName', () => {
  const taken = (names: string[]) => (candidate: string) => names.includes(candidate);

  it('keeps the name when it is free', () => {
    expect(resolveMergeFileName({ fileName: 'a.mp4', isTaken: taken([]), overwrite: false })).toBe('a.mp4');
  });

  it('writes next to an existing file when overwriting is not allowed', () => {
    expect(resolveMergeFileName({ fileName: 'a.mp4', isTaken: taken(['a.mp4']), overwrite: false })).toBe('a (1).mp4');
    expect(resolveMergeFileName({ fileName: 'a.mp4', isTaken: taken(['a.mp4', 'a (1).mp4']), overwrite: false })).toBe('a (2).mp4');
  });

  it('takes the name when overwriting is allowed', () => {
    expect(resolveMergeFileName({ fileName: 'a.mp4', isTaken: taken(['a.mp4']), overwrite: true })).toBe('a.mp4');
  });

  it('puts the suffix before the extension, also without one', () => {
    expect(resolveMergeFileName({ fileName: 'a.mkv', isTaken: taken(['a.mkv']), overwrite: false })).toBe('a (1).mkv');
    expect(resolveMergeFileName({ fileName: 'a', isTaken: taken(['a']), overwrite: false })).toBe('a (1)');
  });

  it('refuses instead of replacing a file when every candidate name is taken', () => {
    expect(resolveMergeFileName({ fileName: 'a.mp4', isTaken: () => true, overwrite: false })).toBeUndefined();
  });
});

describe('appendNameSuffix', () => {
  it('inserts the suffix before the extension', () => {
    expect(appendNameSuffix('clip.mp4', '_fixed')).toBe('clip_fixed.mp4');
  });
  it('handles names with several dots', () => {
    expect(appendNameSuffix('001.part1.mp4', '_merged')).toBe('001.part1_merged.mp4');
  });

  it('appends when there is no extension', () => {
    expect(appendNameSuffix('clip', '_fixed')).toBe('clip_fixed');
  });

  it('appends when the name starts with a dot', () => {
    expect(appendNameSuffix('.hidden', '_fixed')).toBe('.hidden_fixed');
  });
});
