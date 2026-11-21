// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import {
  getRecognizedFinishedDirNames, getRecognizedWorkDirNames, resolvePatchDirNames, samePatchDirName, validatePatchDirName,
} from './dirNames.js';
import { defaultPatchFinishedDirName, defaultPatchWorkDirName } from './workDirs.js';

describe('validatePatchDirName', () => {
  it('accepts the defaults and other plain folder names', () => {
    expect(validatePatchDirName(defaultPatchWorkDirName)).toBeUndefined();
    expect(validatePatchDirName(defaultPatchFinishedDirName)).toBeUndefined();
    expect(validatePatchDirName('work')).toBeUndefined();
    expect(validatePatchDirName('  仕事  ')).toBeUndefined();
  });

  it('rejects an empty name', () => {
    expect(validatePatchDirName('')).toBe('empty');
    expect(validatePatchDirName(' '.repeat(3))).toBe('empty');
  });

  it('rejects path separators (a name is one folder, not a path)', () => {
    expect(validatePatchDirName('a/b')).toBe('path-separator');
    expect(validatePatchDirName(String.raw`a\b`)).toBe('path-separator');
  });

  it('rejects characters Windows refuses in a folder name', () => {
    for (const name of ['a:b', 'a?b', 'a*b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\0b']) {
      expect(validatePatchDirName(name)).toBe('invalid-character');
    }
  });

  it('rejects the dot references and a trailing dot (a trailing space is trimmed away)', () => {
    expect(validatePatchDirName('.')).toBe('invalid-character');
    expect(validatePatchDirName('..')).toBe('invalid-character');
    expect(validatePatchDirName('work.')).toBe('trailing-dot-or-space');
    expect(validatePatchDirName('work ')).toBeUndefined();
  });

  it('rejects Windows reserved device names, also with an extension', () => {
    expect(validatePatchDirName('CON')).toBe('reserved-name');
    expect(validatePatchDirName('con.txt')).toBe('reserved-name');
    expect(validatePatchDirName('lpt9')).toBe('reserved-name');
    expect(validatePatchDirName('CON1')).toBeUndefined();
  });

  it('rejects a name that is too long', () => {
    expect(validatePatchDirName('a'.repeat(256))).toBe('too-long');
    expect(validatePatchDirName('a'.repeat(255))).toBeUndefined();
  });
});

describe('samePatchDirName', () => {
  it('compares trimmed names case-insensitively', () => {
    expect(samePatchDirName('Work', ' work ')).toBe(true);
    expect(samePatchDirName('work', 'work2')).toBe(false);
  });
});

describe('resolvePatchDirNames', () => {
  it('uses the defaults when nothing is configured', () => {
    expect(resolvePatchDirNames({ workDir: undefined, finishedDir: undefined })).toStrictEqual({
      workDir: defaultPatchWorkDirName,
      finishedDir: defaultPatchFinishedDirName,
    });
  });

  it('keeps valid configured names (trimmed)', () => {
    expect(resolvePatchDirNames({ workDir: '  work  ', finishedDir: 'done' })).toStrictEqual({ workDir: 'work', finishedDir: 'done' });
  });

  it('falls back per field, so one bad value does not reset the other', () => {
    expect(resolvePatchDirNames({ workDir: 'a/b', finishedDir: 'done' })).toStrictEqual({ workDir: defaultPatchWorkDirName, finishedDir: 'done' });
    expect(resolvePatchDirNames({ workDir: 'work', finishedDir: '' })).toStrictEqual({ workDir: 'work', finishedDir: defaultPatchFinishedDirName });
  });

  it('never returns the same folder twice', () => {
    expect(resolvePatchDirNames({ workDir: 'same', finishedDir: 'SAME' })).toStrictEqual({ workDir: 'same', finishedDir: defaultPatchFinishedDirName });
    // The work name may itself be the default finished name; the finished folder then moves aside.
    expect(resolvePatchDirNames({ workDir: defaultPatchFinishedDirName, finishedDir: defaultPatchFinishedDirName })).toStrictEqual({
      workDir: defaultPatchWorkDirName,
      finishedDir: defaultPatchFinishedDirName,
    });
  });

  it('never lets one folder be both a work area and a finished area', () => {
    // The defaults keep being recognized after a rename, so a configured name may not be the *other*
    // folder's default: the work name falls back instead (and so does the finished name).
    expect(resolvePatchDirNames({ workDir: defaultPatchFinishedDirName, finishedDir: 'done' })).toStrictEqual({
      workDir: defaultPatchWorkDirName,
      finishedDir: 'done',
    });
    expect(resolvePatchDirNames({ workDir: 'work', finishedDir: defaultPatchWorkDirName })).toStrictEqual({
      workDir: 'work',
      finishedDir: defaultPatchFinishedDirName,
    });
    // The two recognition lists stay disjoint for every combination a stored setting can produce.
    for (const names of [
      resolvePatchDirNames({ workDir: 'work', finishedDir: 'done' }),
      resolvePatchDirNames({ workDir: defaultPatchFinishedDirName, finishedDir: 'done' }),
      resolvePatchDirNames({ workDir: 'work', finishedDir: defaultPatchWorkDirName }),
      resolvePatchDirNames({ workDir: defaultPatchFinishedDirName, finishedDir: defaultPatchWorkDirName }),
    ]) {
      const work = getRecognizedWorkDirNames(names).map((name) => name.toLowerCase());
      const finished = new Set(getRecognizedFinishedDirNames(names).map((name) => name.toLowerCase()));
      expect(work.filter((name) => finished.has(name))).toStrictEqual([]);
    }
  });
});

describe('recognition names', () => {
  it('always recognizes the configured name and the default', () => {
    expect(getRecognizedWorkDirNames({ workDir: 'work', finishedDir: 'done' })).toStrictEqual(['work', defaultPatchWorkDirName]);
    expect(getRecognizedFinishedDirNames({ workDir: 'work', finishedDir: 'done' })).toStrictEqual(['done', defaultPatchFinishedDirName]);
  });

  it('does not repeat the default when it is configured', () => {
    expect(getRecognizedWorkDirNames({ workDir: defaultPatchWorkDirName, finishedDir: defaultPatchFinishedDirName })).toStrictEqual([defaultPatchWorkDirName]);
  });
});
