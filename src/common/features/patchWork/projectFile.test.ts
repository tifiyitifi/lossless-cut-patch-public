// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getProjectFileLookup, getVideoNamedProjectCandidates, getVideoNamedProjectFileName, shouldSuppressProjectSave } from './projectFile.js';

describe('getProjectFileLookup', () => {
  it('keeps the upstream behaviour in base mode', () => {
    expect(getProjectFileLookup({ patchMode: false, outDir: '/custom', upstreamOutDir: '/custom', workAreaDir: undefined })).toStrictEqual({ dir: '/custom', legacyDir: undefined });
  });

  it('looks in the upstream custom output directory in patch mode', () => {
    expect(getProjectFileLookup({ patchMode: true, outDir: '/work/.losslesscut_work/clips', upstreamOutDir: '/custom', workAreaDir: '/work/.losslesscut_work/clips' })).toStrictEqual({ dir: '/custom', legacyDir: '/work/.losslesscut_work/clips' });
  });

  it('looks next to the source video when there is no custom output directory', () => {
    expect(getProjectFileLookup({ patchMode: true, outDir: '/work/.losslesscut_work/clips', upstreamOutDir: undefined, workAreaDir: '/work/.losslesscut_work/clips' })).toStrictEqual({ dir: undefined, legacyDir: '/work/.losslesscut_work/clips' });
  });

  it('never looks in the work area first in patch mode', () => {
    const { dir } = getProjectFileLookup({ patchMode: true, outDir: '/work/.losslesscut_work/clips', upstreamOutDir: undefined, workAreaDir: '/work/.losslesscut_work/clips' });
    expect(dir).not.toBe('/work/.losslesscut_work/clips');
  });

  it('has no legacy directory in base mode', () => {
    expect(getProjectFileLookup({ patchMode: false, outDir: '/custom', upstreamOutDir: '/custom', workAreaDir: '/work/.losslesscut_work/clips' }).legacyDir).toBeUndefined();
  });
});

describe('getVideoNamedProjectFileName', () => {
  it('names the cut list after the video', () => {
    expect(getVideoNamedProjectFileName('C:/work/inbox/a.mp4')).toBe('a.llc');
    expect(getVideoNamedProjectFileName('C:/work/inbox/a (1).mp4')).toBe('a (1).llc');
    expect(getVideoNamedProjectFileName('C:/work/inbox/a')).toBe('a.llc');
  });
});

describe('getVideoNamedProjectCandidates', () => {
  it('tries the working directory before the video folder', () => {
    expect(getVideoNamedProjectCandidates({ videoPath: 'C:/work/inbox/a.mp4', preferredDir: 'C:/work/out' })).toStrictEqual([
      { path: 'C:/work/out/a.llc', inSourceDir: false },
      { path: 'C:/work/inbox/a.llc', inSourceDir: true },
    ]);
  });

  it('only looks next to the video without a working directory', () => {
    expect(getVideoNamedProjectCandidates({ videoPath: 'C:/work/inbox/a.mp4', preferredDir: undefined })).toStrictEqual([
      { path: 'C:/work/inbox/a.llc', inSourceDir: true },
    ]);
  });

  it('reports a shared folder once, as the source folder', () => {
    expect(getVideoNamedProjectCandidates({ videoPath: 'C:/work/inbox/a.mp4', preferredDir: 'C:/work/inbox' })).toStrictEqual([
      { path: 'C:/work/inbox/a.llc', inSourceDir: true },
    ]);
    expect(getVideoNamedProjectCandidates({ videoPath: 'C:/work/inbox/a.mp4', preferredDir: 'C:/WORK/INBOX/', caseInsensitive: true })).toStrictEqual([
      { path: 'C:/work/inbox/a.llc', inSourceDir: true },
    ]);
  });

  it('has no candidate for a file without a stem', () => {
    expect(getVideoNamedProjectCandidates({ videoPath: 'C:/work/inbox/.mp4', preferredDir: 'C:/work/out' })).toStrictEqual([]);
  });
});

describe('shouldSuppressProjectSave', () => {
  const suppression = { filePath: 'C:/work/inbox/a.mp4', projectPath: 'C:/work/inbox/a.llc' };
  const inSource = { suppression, filePath: 'C:/work/inbox/a.mp4', projectFileSavePath: 'C:/work/inbox/a-proj.llc', segmentsEqual: true };

  it('holds back the unchanged save of a video-named cut list', () => {
    expect(shouldSuppressProjectSave(inSource)).toBe(true);
    expect(shouldSuppressProjectSave({ ...inSource, projectFileSavePath: 'C:/work/out/a-proj.llc' })).toBe(true);
  });

  it('never holds back without a hold', () => {
    expect(shouldSuppressProjectSave({ ...inSource, suppression: undefined })).toBe(false);
  });

  it('never holds back a changed cut list', () => {
    expect(shouldSuppressProjectSave({ ...inSource, segmentsEqual: false })).toBe(false);
  });

  it('never holds back after a file switch', () => {
    expect(shouldSuppressProjectSave({ ...inSource, filePath: 'C:/work/inbox/b.mp4' })).toBe(false);
  });

  it('never holds back the canonical name or an arbitrary .llc', () => {
    expect(shouldSuppressProjectSave({
      ...inSource,
      suppression: { filePath: 'C:/work/inbox/a.mp4', projectPath: 'C:/work/inbox/a-proj.llc' },
      projectFileSavePath: 'C:/work/inbox/a.llc',
    })).toBe(false);
    expect(shouldSuppressProjectSave({
      ...inSource,
      suppression: { filePath: 'C:/work/inbox/a.mp4', projectPath: 'C:/work/inbox/notes.llc' },
      projectFileSavePath: 'C:/work/inbox/a-proj.llc',
    })).toBe(false);
  });

  it('never holds back a save to the file it read', () => {
    expect(shouldSuppressProjectSave({ ...inSource, projectFileSavePath: 'C:/work/inbox/a.llc' })).toBe(false);
  });
});
