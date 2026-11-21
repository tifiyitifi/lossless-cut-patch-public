// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { defaultPatchDirNames, defaultPatchWorkDirName, getPatchRepairTmpFileName, getPatchWorkDirNames, patchRepairTmpDirName, patchWorkSubdirs, resolvePatchWorkRoot } from './workDirs.js';

describe('getPatchWorkDirNames', () => {
  it('keeps the work area inside the working directory', () => {
    const names = getPatchWorkDirNames();
    expect(names.workDir).toBe(defaultPatchWorkDirName);
    expect(names.clipsDir).toBe(`${defaultPatchWorkDirName}/${patchWorkSubdirs.clips}`);
    expect(names.mergedDir).toBe(`${defaultPatchWorkDirName}/${patchWorkSubdirs.merged}`);
  });

  it('uses a configured work folder name', () => {
    const names = getPatchWorkDirNames({ workDir: 'work', finishedDir: 'done' });
    expect(names.workDir).toBe('work');
    expect(names.clipsDir).toBe(`work/${patchWorkSubdirs.clips}`);
    expect(names.mergedDir).toBe(`work/${patchWorkSubdirs.merged}`);
  });

  it('defaults to the documented names', () => {
    expect(defaultPatchDirNames).toStrictEqual({ workDir: defaultPatchWorkDirName, finishedDir: 'losslesscut_finished' });
  });

  it('gives every stage its own directory', () => {
    const names = getPatchWorkDirNames();
    expect(new Set(Object.values(names)).size).toBe(3);
  });
});

describe('getPatchRepairTmpFileName', () => {
  it('puts a temporary repair output in its own folder inside the cut results', () => {
    expect(getPatchRepairTmpFileName('a-reformatted.mp4')).toBe(`${patchRepairTmpDirName}/a-reformatted.mp4`);
    expect(getPatchRepairTmpFileName('a-reformatted.mp4')).toBe('repairing_tmp/a-reformatted.mp4');
  });
});

describe('resolvePatchWorkRoot', () => {
  it('prefers the working directory', () => {
    expect(resolvePatchWorkRoot({ workRoot: '/data/work', sourceDir: '/data/videos' })).toBe('/data/work');
  });

  it('falls back to the source folder without a working directory', () => {
    expect(resolvePatchWorkRoot({ workRoot: undefined, sourceDir: '/data/videos' })).toBe('/data/videos');
  });

  it('ignores blank values', () => {
    expect(resolvePatchWorkRoot({ workRoot: '  ', sourceDir: ' /data/videos ' })).toBe('/data/videos');
    expect(resolvePatchWorkRoot({ workRoot: '', sourceDir: '' })).toBeUndefined();
  });

  it('has no root without a source', () => {
    expect(resolvePatchWorkRoot({ workRoot: undefined, sourceDir: undefined })).toBeUndefined();
  });
});
