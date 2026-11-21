// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { FileNameTemplateContext } from '../../userTypes.js';
import { formatEpochMsForFileName } from '../patchData/naming.js';
import type { PatchNameContext } from './playerMode.js';
import { applyLabelToNameContext, filenamifyResultLabel, getResultFileNameProblem, isFileLockError, resolveTypedResultRename, sanitizeResultLabel } from './renameResult.js';

const context: FileNameTemplateContext = {
  FILENAME: 'source',
  FILES: [],
  SEG_SUFFIX: '-old',
  EXT: '.mp4',
  SEG_NUM: '01',
  SEG_LABEL: 'old',
  EPOCH_MS: 1234,
  CUT_FROM: '00-00-01',
  CUT_TO: '00-00-02',
};

const nameContext: PatchNameContext = {
  // eslint-disable-next-line no-template-curly-in-string
  template: '${FILENAME}${SEG_SUFFIX}${EXT}',
  outputDir: '/clips',
  context,
  emptyLabelSuffix: '-seg01',
  maxLabelLength: 100,
  safeOutputFileName: true,
};

describe('filenamifyResultLabel', () => {
  it('replaces the characters the export replaces', () => {
    expect(filenamifyResultLabel(String.raw`a:b/c\d*e?f"g<h>i|j`)).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(filenamifyResultLabel('开场 01 - v2_final.')).toBe('开场 01 - v2_final.');
  });
});

describe('sanitizeResultLabel', () => {
  it('sanitizes only when safe file names are enabled', () => {
    expect(sanitizeResultLabel({ label: 'a:b', safeOutputFileName: true, maxLabelLength: 100 })).toBe('a_b');
    expect(sanitizeResultLabel({ label: 'a:b', safeOutputFileName: false, maxLabelLength: 100 })).toBe('a:b');
  });

  it('truncates to the export label length', () => {
    expect(sanitizeResultLabel({ label: 'abcdef', safeOutputFileName: false, maxLabelLength: 4 })).toBe('abcd');
  });
});

describe('applyLabelToNameContext', () => {
  it('replaces the label and its suffix', () => {
    const result = applyLabelToNameContext(nameContext, 'new');
    expect(result.SEG_LABEL).toBe('new');
    expect(result.SEG_SUFFIX).toBe('-new');
  });

  it('keeps every other variable as it was at export time', () => {
    const result = applyLabelToNameContext(nameContext, 'new');
    expect(result.FILENAME).toBe('source');
    expect(result.CUT_FROM).toBe('00-00-01');
    expect(result.EPOCH_MS).toBe(1234);
  });

  it('falls back to the empty label suffix when the label is cleared', () => {
    expect(applyLabelToNameContext(nameContext, '').SEG_SUFFIX).toBe('-seg01');
    expect(applyLabelToNameContext(nameContext, '').SEG_LABEL).toBe('');
  });

  it('sanitizes the new label the same way the export did', () => {
    expect(applyLabelToNameContext(nameContext, 'a:b').SEG_SUFFIX).toBe('-a_b');
  });

  it('does not mutate the stored context', () => {
    applyLabelToNameContext(nameContext, 'new');
    expect(nameContext.context.SEG_LABEL).toBe('old');
    expect(nameContext.context.SEG_SUFFIX).toBe('-old');
  });

  it('backfills the readable stamp for a project written before it existed', () => {
    expect(applyLabelToNameContext(nameContext, 'new').EPOCH_STR)
      .toBe(formatEpochMsForFileName(nameContext.context.EPOCH_MS));
  });

  it('keeps the stored readable stamp when the project has one', () => {
    const withStamp = { ...nameContext, context: { ...nameContext.context, EPOCH_STR: '2026-10-26--18_01_06.019' } };
    expect(applyLabelToNameContext(withStamp, 'new').EPOCH_STR).toBe('2026-10-26--18_01_06.019');
  });
});

describe('getResultFileNameProblem', () => {
  const windows = { isWindows: true, isMac: false };
  const mac = { isWindows: false, isMac: true };
  const linux = { isWindows: false, isMac: false };

  it('accepts an ordinary name', () => {
    expect(getResultFileNameProblem('clip 01 - intro', windows)).toBeUndefined();
  });

  it('rejects the characters Windows does not allow', () => {
    expect(getResultFileNameProblem('a:b*c', windows)).toMatchObject({ code: 'invalidChars' });
  });

  it('always rejects path separators, so the name cannot leave the result directory', () => {
    expect(getResultFileNameProblem(String.raw`..\..\escape`, windows)).toMatchObject({ code: 'invalidChars' });
    expect(getResultFileNameProblem('../escape', linux)).toMatchObject({ code: 'invalidChars' });
  });

  it('rejects a trailing dot or space on Windows', () => {
    expect(getResultFileNameProblem('clip.', windows)).toStrictEqual({ code: 'trailing' });
    expect(getResultFileNameProblem('clip ', windows)).toStrictEqual({ code: 'trailing' });
    expect(getResultFileNameProblem('clip.', linux)).toBeUndefined();
  });

  it('rejects the reserved Windows device names', () => {
    expect(getResultFileNameProblem('CON', windows)).toStrictEqual({ code: 'reserved' });
    expect(getResultFileNameProblem('lpt1.mp4', windows)).toStrictEqual({ code: 'reserved' });
    expect(getResultFileNameProblem('CON', linux)).toBeUndefined();
  });

  it('rejects an overlong name', () => {
    expect(getResultFileNameProblem('a'.repeat(251), windows)).toStrictEqual({ code: 'tooLong' });
  });

  it('rejects the colon on macOS', () => {
    expect(getResultFileNameProblem('a:b', mac)).toMatchObject({ code: 'invalidChars' });
  });
});

describe('resolveTypedResultRename', () => {
  const windows = { isWindows: true, isMac: false };
  const linux = { isWindows: false, isMac: false };

  const resolve = (value: string, options: { currentName?: string, extension?: string, isWindows?: boolean, isMac?: boolean } = {}) => resolveTypedResultRename({
    value,
    currentName: options.currentName ?? 'clip',
    extension: options.extension ?? '.mp4',
    isWindows: options.isWindows ?? true,
    isMac: options.isMac ?? false,
  });

  it('renames to the name the user typed', () => {
    expect(resolve('intro', windows)).toStrictEqual({ kind: 'rename', baseName: 'intro' });
  });

  it('does not add the extension twice when the user typed it', () => {
    // The dialog asks for the name without the extension, but users type it anyway.
    expect(resolve('clip.mp4', windows)).toStrictEqual({ kind: 'unchanged' });
    expect(resolve('intro.mp4', windows)).toStrictEqual({ kind: 'rename', baseName: 'intro' });
    expect(resolve('intro.MP4', windows)).toStrictEqual({ kind: 'rename', baseName: 'intro' });
  });

  it('keeps an extension that is not the one of the file', () => {
    expect(resolve('intro.v2', { ...windows, extension: '.mkv' })).toStrictEqual({ kind: 'rename', baseName: 'intro.v2' });
  });

  it('does nothing when the name does not change', () => {
    expect(resolve('clip', windows)).toStrictEqual({ kind: 'unchanged' });
    expect(resolve('', windows)).toStrictEqual({ kind: 'unchanged' });
    expect(resolve(' '.repeat(3), windows)).toStrictEqual({ kind: 'unchanged' });
    expect(resolve('.mp4', windows)).toStrictEqual({ kind: 'unchanged' });
  });

  it('reports a name the file system would not accept', () => {
    expect(resolve('a:b', windows)).toMatchObject({ kind: 'invalid', problem: { code: 'invalidChars' } });
    expect(resolve('intro.', windows)).toMatchObject({ kind: 'invalid', problem: { code: 'trailing' } });
  });

  it('reports the whitespace around the name the user typed', () => {
    // The name is checked as it was typed: the whitespace around it is a mistake the user should
    // see, not something that is trimmed away silently (the file would get another name than the
    // one the user asked for).
    expect(resolve(' clip', windows)).toMatchObject({ kind: 'invalid', problem: { code: 'surroundingWhitespace' } });
    expect(resolve('clip ', windows)).toMatchObject({ kind: 'invalid', problem: { code: 'surroundingWhitespace' } });
    expect(resolve(' clip ', linux)).toMatchObject({ kind: 'invalid', problem: { code: 'surroundingWhitespace' } });
  });

  it('reports a final name that is too long', () => {
    // The name on the disk is the base name plus the extension.
    expect(resolve('a'.repeat(250), windows)).toMatchObject({ kind: 'invalid', problem: { code: 'tooLong' } });
    expect(resolve('a'.repeat(246), windows)).toStrictEqual({ kind: 'rename', baseName: 'a'.repeat(246) });
  });

  it('allows a trailing dot on Linux', () => {
    expect(resolve('intro.', linux)).toStrictEqual({ kind: 'rename', baseName: 'intro.' });
  });
});

describe('isFileLockError', () => {
  it('recognizes the Windows file-lock errors', () => {
    expect(isFileLockError({ code: 'EPERM' })).toBe(true);
    expect(isFileLockError({ code: 'EBUSY' })).toBe(true);
    expect(isFileLockError({ code: 'EACCES' })).toBe(true);
  });

  it('ignores other errors', () => {
    expect(isFileLockError({ code: 'ENOENT' })).toBe(false);
    expect(isFileLockError(new Error('boom'))).toBe(false);
    expect(isFileLockError(undefined)).toBe(false);
  });
});
