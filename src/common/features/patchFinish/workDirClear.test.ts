// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchFinishCutOptions, PatchFinishMergeOptions } from './options.js';
import { defaultPatchFinishCutOptions, defaultPatchFinishMergeOptions } from './options.js';
import type { PatchFinishPreview } from './preview.js';
import { getFinishWorkDirClearView } from './workDirClear.js';

const dirs = {
  workDir: '/work/.losslesscut_work',
  clipsDir: '/work/.losslesscut_work/clips',
  mergedDir: '/work/.losslesscut_work/merged',
  finishedSrcMediaDir: '/work/losslesscut_finished/finished_src_media',
  finishedSkipSrcMediaDir: '/work/losslesscut_finished/finished_skip_src',
  detachedSrcMediaDir: '/work/.losslesscut_work/detached_src_media',
  finishedMergedDir: '/work/losslesscut_finished/finished_merged',
  finishedClipsDir: '/work/losslesscut_finished/finished_clips',
  detachedClipsDir: '/work/.losslesscut_work/detached_clips',
  detachedMergedDir: '/work/.losslesscut_work/detached_merged',
  finishLlcDir: '/work/losslesscut_finished/finish_llc',
};

const manifestEntry = { path: 'export-manifest.json', kind: 'file' as const };

function preview(overrides: Partial<PatchFinishPreview> = {}): PatchFinishPreview {
  return {
    mode: 'merge',
    source: { path: '/src/a.mp4', size: 100, exists: true, unreadable: false, insideWorkArea: false, dir: '/src' },
    projectFile: { path: '/src/a-proj.llc' },
    merged: { path: `${dirs.mergedDir}/m.mp4`, size: 90, mtimeMs: 300 },
    mergedInsideWorkArea: true,
    clips: [
      { path: `${dirs.clipsDir}/a-1.mp4`, size: 40, mtimeMs: 100 },
      { path: `${dirs.clipsDir}/a-2.mp4`, size: 50, mtimeMs: 110 },
    ],
    clipsTotalSize: 90,
    outsideClipCount: 0,
    missingClipCount: 0,
    missingSelectedClipCount: 0,
    filesInUse: [],
    mergedCoversClips: true,
    hasRecord: true,
    dirs,
    workDirEntries: [
      { path: 'clips', kind: 'directory' },
      { path: 'merged', kind: 'directory' },
      { path: 'clips/a-1.mp4', kind: 'file' },
      { path: 'clips/a-2.mp4', kind: 'file' },
      { path: 'merged/m.mp4', kind: 'file' },
      manifestEntry,
    ],
    workDirScanFailed: false,
    projectStores: {
      userDataLlcDir: '/userdata/llc',
      installLlcDir: '/install/llc',
      installLlcWritable: true,
    },
    warnings: [],
    ...overrides,
  };
}

function view(mode: 'merge' | 'cut', options: PatchFinishMergeOptions | PatchFinishCutOptions, overrides: Partial<PatchFinishPreview> = {}) {
  return getFinishWorkDirClearView({ mode, options, preview: preview({ ...overrides, mode }), caseInsensitive: true, now: new Date(2026, 9, 25) });
}

describe('getFinishWorkDirClearView', () => {
  it('clears the work directory when every result leaves it and the stage folders stay empty', () => {
    const options: PatchFinishCutOptions = {
      ...defaultPatchFinishCutOptions, source: 'keep', clips: 'source', mergedResult: 'delete', projectFile: 'keep', workDir: 'keep',
    };
    expect(view('cut', options)).toStrictEqual({ clearable: true, blockers: [] });
  });

  it('stays clearable when only the app manifest is left', () => {
    const options: PatchFinishCutOptions = {
      ...defaultPatchFinishCutOptions, source: 'keep', clips: 'source', mergedResult: 'delete', projectFile: 'keep',
    };
    expect(view('cut', options, {
      clips: [],
      merged: undefined,
      workDirEntries: [{ path: 'clips', kind: 'directory' }, { path: 'merged', kind: 'directory' }, manifestEntry],
    }).clearable).toBe(true);
  });

  it('blocks the source video that is sent to detached_src_media (no file is deleted)', () => {
    const options: PatchFinishCutOptions = {
      ...defaultPatchFinishCutOptions, source: 'detached', clips: 'source', mergedResult: 'delete',
    };
    expect(view('cut', options).blockers).toContain('detached_src_media/a.mp4');
  });

  it('moves a skipped source out of the work area, like a kept one', () => {
    const options: PatchFinishCutOptions = {
      ...defaultPatchFinishCutOptions, source: 'skip', clips: 'source', mergedResult: 'delete', projectFile: 'keep',
    };
    const source = { path: `${dirs.workDir}/a.mp4`, size: 10, exists: true, unreadable: false, insideWorkArea: true, dir: dirs.workDir };
    const result = view('cut', options, {
      source,
      clips: [],
      merged: undefined,
      workDirEntries: [{ path: 'a.mp4', kind: 'file' }, { path: 'clips', kind: 'directory' }, { path: 'merged', kind: 'directory' }, manifestEntry],
    });
    expect(result.blockers).not.toContain('a.mp4');
    expect(result.clearable).toBe(true);
  });

  it('moves the merged result to finished_merged when a cut job ends with clips', () => {
    const options: PatchFinishCutOptions = {
      ...defaultPatchFinishCutOptions, source: 'keep', clips: 'source', mergedResult: 'finished', projectFile: 'keep',
    };
    expect(view('cut', options)).toStrictEqual({ clearable: true, blockers: [] });
  });

  it('keeps the work area clearable when cut results are kept in finished_clips, but blocks detached_clips', () => {
    // `finished_clips` is a sibling of the work area: the result leaves it, so it cannot block.
    expect(view('cut', { ...defaultPatchFinishCutOptions, source: 'keep', clips: 'finished' }))
      .toStrictEqual({ clearable: true, blockers: [] });
    expect(view('merge', { ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'source', clips: 'detached' }).blockers)
      .toContain('detached_clips/a-1.mp4');
  });

  it('blocks the cleanup when the cut results stay in the work area', () => {
    // `clips: keep` leaves the files where they are, so the folder holds more than the stage
    // folders and the manifest.
    const merge = view('merge', { ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'finished', clips: 'keep', projectFile: 'keep' });
    expect(merge.clearable).toBe(false);
    expect(merge.blockers).toContain('clips/a-1.mp4');

    const cut = view('cut', { ...defaultPatchFinishCutOptions, source: 'keep', clips: 'keep', mergedResult: 'keep', projectFile: 'keep' });
    expect(cut.clearable).toBe(false);
    expect(cut.blockers).toContain('clips/a-2.mp4');
  });

  it('keeps the work area clearable when the merged result is kept in finished_merged', () => {
    const options: PatchFinishMergeOptions = {
      ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'finished', clips: 'delete', projectFile: 'keep',
    };
    expect(view('merge', options)).toStrictEqual({ clearable: true, blockers: [] });
  });

  it('keeps the work area clearable when the project file is archived into finish_llc', () => {
    const options: PatchFinishCutOptions = {
      ...defaultPatchFinishCutOptions, source: 'keep', clips: 'source', mergedResult: 'delete', projectFile: 'finish-llc',
    };
    expect(view('cut', options)).toStrictEqual({ clearable: true, blockers: [] });
  });

  it('blocks a project file moved into a folder inside the work area', () => {
    const options: PatchFinishCutOptions = {
      ...defaultPatchFinishCutOptions, source: 'keep', clips: 'source', mergedResult: 'delete', projectFile: 'custom', projectDir: `${dirs.workDir}/my-llc`, projectDateGrouping: 'none',
    };
    expect(view('cut', options).blockers).toContain('my-llc/a-proj.llc');
  });

  it('blocks unknown files and folders, even a user-created empty one', () => {
    const options: PatchFinishCutOptions = {
      ...defaultPatchFinishCutOptions, source: 'keep', clips: 'source', mergedResult: 'delete', projectFile: 'keep',
    };
    expect(view('cut', options, { workDirEntries: [...preview().workDirEntries, { path: 'notes.txt', kind: 'file' }] }).blockers)
      .toStrictEqual(['notes.txt']);
    expect(view('cut', options, { workDirEntries: [...preview().workDirEntries, { path: 'user-folder', kind: 'directory' }] }).blockers)
      .toStrictEqual(['user-folder']);
  });

  it('blocks a work directory whose scan failed', () => {
    expect(view('cut', defaultPatchFinishCutOptions, { workDirScanFailed: true })).toStrictEqual({ clearable: false, blockers: [] });
  });

  it('takes the project files next to the cut results along (an old build wrote them)', () => {
    const options: PatchFinishCutOptions = {
      ...defaultPatchFinishCutOptions, source: 'keep', clips: 'source', mergedResult: 'delete', projectFile: 'keep',
    };
    const withSidecars = {
      workDirEntries: [
        ...preview().workDirEntries,
        { path: 'clips/a-1-proj.llc', kind: 'file' as const },
        { path: 'clips/a-2-proj.llc', kind: 'file' as const },
      ],
    };
    // The executor deletes them with their videos, so the prediction stays clearable.
    expect(view('cut', options, withSidecars)).toStrictEqual({ clearable: true, blockers: [] });
    // Kept results leave the work area together with their videos and project files.
    expect(view('cut', { ...options, clips: 'finished' }, withSidecars)).toStrictEqual({ clearable: true, blockers: [] });
    // Parked results stay inside the work area, so they block it with their videos.
    expect(view('merge', { ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'source', clips: 'detached' }, withSidecars).blockers)
      .toStrictEqual(expect.arrayContaining(['detached_clips/a-1.mp4', 'detached_clips/a-1-proj.llc']));
  });

  it('takes the project file next to the merged result along', () => {
    const options: PatchFinishMergeOptions = {
      ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'finished', clips: 'delete', projectFile: 'keep',
    };
    const withSidecar = {
      workDirEntries: [...preview().workDirEntries, { path: 'merged/m-proj.llc', kind: 'file' as const }],
    };
    // Both leave the work area, so the sidecar never becomes a blocker of its own.
    expect(view('merge', options, withSidecar)).toStrictEqual({ clearable: true, blockers: [] });
  });

  it('keeps the prediction conservative when the merge is stale', () => {
    const options: PatchFinishMergeOptions = {
      ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'source', clips: 'delete',
    };
    expect(view('merge', options, { mergedCoversClips: false }).blockers).toContain('detached_clips/a-1.mp4');
  });
});
