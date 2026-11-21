// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchWorkDirEntry } from './emptyWorkDirs.js';
import { getWorkDirClearDecision, isClearableWorkDirPath, patchWorkClearableSubdirs } from './emptyWorkDirs.js';

const entry = (path: string, kind: PatchWorkDirEntry['kind'] = 'directory'): PatchWorkDirEntry => ({ path, kind });

describe('getWorkDirClearDecision', () => {
  it('accepts an empty work directory and the known stage folders', () => {
    expect(getWorkDirClearDecision({ entries: [], caseInsensitive: true })).toStrictEqual({ clearable: true, blockers: [] });
    expect(getWorkDirClearDecision({
      entries: patchWorkClearableSubdirs.map((path) => entry(path)),
      caseInsensitive: true,
    })).toStrictEqual({ clearable: true, blockers: [] });
  });

  it('accepts the export manifest and its app-owned siblings at the root', () => {
    expect(getWorkDirClearDecision({
      entries: [
        entry('clips'),
        entry('merged'),
        entry('export-manifest.json', 'file'),
        entry('export-manifest.json.tmp', 'file'),
        entry('export-manifest.json.4242.tmp', 'file'),
        entry('export-manifest.json.bad', 'file'),
        entry('export-manifest.json.bad.1', 'file'),
      ],
      caseInsensitive: true,
    })).toStrictEqual({ clearable: true, blockers: [] });
  });

  it('refuses a work area another window is using (the lock is not on the whitelist)', () => {
    expect(getWorkDirClearDecision({ entries: [entry('.export.lock', 'file')], caseInsensitive: true })).toStrictEqual({
      clearable: false,
      blockers: ['.export.lock'],
    });
  });

  it('lets the job that holds the lock clean up its own work area', () => {
    // The finish job takes `.export.lock` itself before it runs and clears the area at its end, so
    // its own lock cannot mean "another window is using this folder" (see `features/patchFinish`).
    expect(getWorkDirClearDecision({ entries: [entry('.export.lock', 'file')], caseInsensitive: true, ignoreLock: true }))
      .toStrictEqual({ clearable: true, blockers: [] });
    // Everything else still blocks: only the lock is ignored.
    expect(getWorkDirClearDecision({
      entries: [entry('.export.lock', 'file'), entry('notes.txt', 'file')],
      caseInsensitive: true,
      ignoreLock: true,
    }).blockers).toStrictEqual(['notes.txt']);
    // A folder of that name is not the lock file the job wrote.
    expect(getWorkDirClearDecision({ entries: [entry('.export.lock')], caseInsensitive: true, ignoreLock: true }).clearable)
      .toBe(false);
  });

  it('refuses any user-created file, even an empty one', () => {
    expect(getWorkDirClearDecision({ entries: [entry('notes.txt', 'file')], caseInsensitive: true })).toStrictEqual({
      clearable: false,
      blockers: ['notes.txt'],
    });
  });

  it('accepts the emptied temporary repair folder, but not what it holds', () => {
    // The app owns `clips/repairing_tmp` and nothing would ever remove an emptied folder, so it must
    // not pin the work area forever - a leftover file still blocks, because it may be the user's.
    expect(getWorkDirClearDecision({ entries: [entry('clips'), entry('clips/repairing_tmp')], caseInsensitive: true }))
      .toStrictEqual({ clearable: true, blockers: [] });
    expect(getWorkDirClearDecision({
      entries: [entry('clips'), entry('clips/repairing_tmp'), entry('clips/repairing_tmp/a-reformatted.mp4', 'file')],
      caseInsensitive: true,
    })).toStrictEqual({ clearable: false, blockers: ['clips/repairing_tmp/a-reformatted.mp4'] });
    // Only a folder of that name: a file there is not the app's folder.
    expect(getWorkDirClearDecision({ entries: [entry('clips'), entry('clips/repairing_tmp', 'file')], caseInsensitive: true }))
      .toStrictEqual({ clearable: false, blockers: ['clips/repairing_tmp'] });
    // The name follows the file system's case rules like every other whitelist entry.
    expect(getWorkDirClearDecision({ entries: [entry('CLIPS/REPAIRING_TMP')], caseInsensitive: true }).clearable).toBe(true);
    expect(getWorkDirClearDecision({ entries: [entry('CLIPS/REPAIRING_TMP')], caseInsensitive: false }).clearable).toBe(false);
  });

  it('refuses a user-created empty folder and nested folders', () => {
    expect(getWorkDirClearDecision({ entries: [entry('my-folder')], caseInsensitive: true }))
      .toStrictEqual({ clearable: false, blockers: ['my-folder'] });
    expect(getWorkDirClearDecision({ entries: [entry('clips'), entry('clips/nested')], caseInsensitive: true }))
      .toStrictEqual({ clearable: false, blockers: ['clips/nested'] });
  });

  it('refuses a file inside a stage folder, including a project file', () => {
    expect(getWorkDirClearDecision({ entries: [entry('clips', 'directory'), entry('clips/a.mp4', 'file')], caseInsensitive: true }))
      .toStrictEqual({ clearable: false, blockers: ['clips/a.mp4'] });
    expect(getWorkDirClearDecision({ entries: [entry('finished_src_media'), entry('finished_llc/a-proj.llc', 'file')], caseInsensitive: true }))
      .toStrictEqual({ clearable: false, blockers: ['finished_llc/a-proj.llc'] });
  });

  it('refuses a stage folder name occupied by a file', () => {
    expect(getWorkDirClearDecision({ entries: [entry('clips', 'file')], caseInsensitive: true }))
      .toStrictEqual({ clearable: false, blockers: ['clips'] });
  });

  it('refuses symlinks, junctions and other entries', () => {
    expect(getWorkDirClearDecision({ entries: [entry('linked', 'other')], caseInsensitive: true }))
      .toStrictEqual({ clearable: false, blockers: ['linked'] });
  });

  it('compares names case-insensitively only when the file system does', () => {
    expect(getWorkDirClearDecision({ entries: [entry('CLIPS')], caseInsensitive: true }).clearable).toBe(true);
    expect(getWorkDirClearDecision({ entries: [entry('CLIPS')], caseInsensitive: false }).clearable).toBe(false);
    expect(getWorkDirClearDecision({ entries: [entry('EXPORT-MANIFEST.JSON', 'file')], caseInsensitive: true }).clearable).toBe(true);
    expect(getWorkDirClearDecision({ entries: [entry('EXPORT-MANIFEST.JSON', 'file')], caseInsensitive: false }).clearable).toBe(false);
  });

  it('normalizes Windows separators and a leading dot segment', () => {
    expect(getWorkDirClearDecision({ entries: [entry(String.raw`clips\nested`)], caseInsensitive: true }).blockers)
      .toStrictEqual(['clips/nested']);
    expect(getWorkDirClearDecision({ entries: [entry('./export-manifest.json', 'file')], caseInsensitive: true }).clearable).toBe(true);
  });
});

describe('isClearableWorkDirPath', () => {
  it('refuses roots and empty paths', () => {
    expect(isClearableWorkDirPath('')).toBe(false);
    expect(isClearableWorkDirPath(' '.repeat(3))).toBe(false);
    expect(isClearableWorkDirPath('/')).toBe(false);
    expect(isClearableWorkDirPath('.')).toBe(false);
    expect(isClearableWorkDirPath('C:')).toBe(false);
    expect(isClearableWorkDirPath('C:/work/.losslesscut_work')).toBe(true);
  });

  it('only accepts the work area itself, not its parent or a stage folder', () => {
    expect(isClearableWorkDirPath('C:/work')).toBe(false);
    expect(isClearableWorkDirPath('C:/work/.losslesscut_work/clips')).toBe(false);
    expect(isClearableWorkDirPath('/work/.losslesscut_work/')).toBe(true);
  });

  it('accepts the configured name and keeps accepting the default', () => {
    const dirNames = { workDir: 'work', finishedDir: 'done' };
    expect(isClearableWorkDirPath('C:/videos/work', { dirNames })).toBe(true);
    expect(isClearableWorkDirPath('C:/videos/.losslesscut_work', { dirNames })).toBe(true);
    expect(isClearableWorkDirPath('C:/videos/done', { dirNames })).toBe(false);
  });

  it('compares the name case-insensitively when asked', () => {
    const dirNames = { workDir: 'Work', finishedDir: 'done' };
    expect(isClearableWorkDirPath('C:/videos/WORK', { dirNames, caseInsensitive: true })).toBe(true);
    expect(isClearableWorkDirPath('C:/videos/WORK', { dirNames, caseInsensitive: false })).toBe(false);
  });
});
