// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchExportManifest } from '../../../common/features/patchExport/index.js';
import { emptyPatchExportManifest } from '../../../common/features/patchExport/index.js';
import type { PatchFinishPreview } from '../../../common/features/patchFinish/index.js';
import { defaultPatchFinishCutOptions, defaultPatchFinishDiscardOptions, defaultPatchFinishMergeOptions, normalizePath } from '../../../common/features/patchFinish/index.js';
import { buildPatchFinishPreview } from './preview.js';

const workRoot = '/work';
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
} satisfies PatchFinishPreview['dirs'];

const projectStores = {
  userDataLlcDir: '/home/u/.config/LosslessCut/llc',
  installLlcDir: '/opt/LosslessCut/llc',
  installLlcWritable: true,
} satisfies PatchFinishPreview['projectStores'];

const sourcePath = '/src/a.mp4';

function manifestWith({ merged, clips }: { merged?: { path: string }, clips?: Record<string, string> } = {}): PatchExportManifest {
  return {
    version: 1,
    files: {
      [sourcePath]: {
        signature: 'sig',
        segments: Object.fromEntries(Object.entries(clips ?? {}).map(([segId, path]) => [segId, { start: 0, end: 10, path, signature: 'sig' }])),
        ...((merged != null) && { merged: { signature: 'msig', path: merged.path } }),
      },
    },
  };
}

function stats(files: Record<string, number>) {
  return async (path: string) => {
    const size = files[normalizePath(path)];
    if (size == null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { size, mtimeMs: size };
  };
}

describe('buildPatchFinishPreview', () => {
  it('reads the source, the project file, the merged result and the cut results', async () => {
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, projectFilePath: '/src/a-proj.llc', mode: 'auto' }, {
      readManifest: async () => manifestWith({ merged: { path: `${dirs.mergedDir}/a-merged.mp4` }, clips: { s1: `${dirs.clipsDir}/a-1.mp4`, s2: `${dirs.clipsDir}/a-2.mp4` } }),
      stat: stats({
        [sourcePath]: 100,
        '/src/a-proj.llc': 1,
        [`${dirs.mergedDir}/a-merged.mp4`]: 90,
        [`${dirs.clipsDir}/a-1.mp4`]: 40,
        [`${dirs.clipsDir}/a-2.mp4`]: 50,
      }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.mode).toBe('merge');
    expect(preview.source).toMatchObject({ exists: true, size: 100, insideWorkArea: false });
    expect(preview.projectFile).toStrictEqual({ path: '/src/a-proj.llc' });
    expect(preview.clips).toHaveLength(2);
    // The project file records which segment a result came from.
    expect(preview.clips.map((clip) => clip.segId)).toStrictEqual(['s1', 's2']);
    // The finish rename renders `{label}` / `{cut_from}` / `{cut_to}` from the record.
    expect(preview.clips.map((clip) => ({ start: clip.start, end: clip.end }))).toStrictEqual([{ start: 0, end: 10 }, { start: 0, end: 10 }]);
    // This merge was recorded without chapters, so there is nothing to carry.
    expect(preview.mergedSegIds).toBeUndefined();
    expect(preview.clipsTotalSize).toBe(90);
    expect(preview.mergedCoversClips).toBe(true);
    expect(preview.mergedInsideWorkArea).toBe(true);
    expect(preview.hasRecord).toBe(true);
    expect(preview.projectStores).toStrictEqual(projectStores);
    expect(preview.warnings).toStrictEqual([]);
  });

  it('lists the results already in finished_clips, minus the segments this export cuts again', async () => {
    const reCutPath = `${dirs.finishedClipsDir}/a-clip-1.mp4`;
    const keptPath = `${dirs.finishedClipsDir}/a-clip-2.mp4`;
    const otherSourcePath = `${dirs.finishedClipsDir}/b-clip-1.mp4`;
    const manifest: PatchExportManifest = {
      version: 1,
      files: {
        [sourcePath]: {
          signature: 'sig',
          order: ['s1'],
          segments: { s1: { start: 0, end: 10, path: `${dirs.clipsDir}/a-1.mp4`, signature: 'sig' } },
        },
      },
    };

    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, projectFilePath: '/src/a-proj.llc', mode: 'cut' }, {
      readManifest: async () => manifest,
      stat: stats({
        [sourcePath]: 100,
        '/src/a-proj.llc': 1,
        [`${dirs.clipsDir}/a-1.mp4`]: 40,
        [reCutPath]: 30,
        [keptPath]: 20,
        [otherSourcePath]: 10,
      }),
      listMediaFiles: async () => [reCutPath, keptPath, otherSourcePath],
      readText: async () => `{
  version: 3,
  patchExport: { mode: 'cut', merged: [], clips: [{ path: 'a-clip-1.mp4', segId: 's1' }, { path: 'a-clip-2.mp4', segId: 's2' }] },
  cutSegments: [],
}`,
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    // `a-clip-1` belongs to the segment this export cuts again, and `b-clip-1` is another source's.
    expect(preview.finishedClips?.map((clip) => clip.path)).toStrictEqual([keptPath]);
  });

  it('carries the clip label so the finish rename can render {label}', async () => {
    const clipPath = `${dirs.clipsDir}/a-1.mp4`;
    const manifest: PatchExportManifest = {
      version: 1,
      files: {
        [sourcePath]: {
          signature: 'sig',
          segments: { s1: { start: 4, end: 9, label: 'intro', path: clipPath, signature: 'sig' } },
        },
      },
    };

    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      readManifest: async () => manifest,
      stat: stats({ [sourcePath]: 100, [clipPath]: 40 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.clips[0]).toMatchObject({ path: clipPath, label: 'intro', start: 4, end: 9 });
  });

  it('uses the merge inputs instead of the file timestamps', async () => {
    // The work area was copied or restored: the merged file carries an older timestamp than the
    // cut results although it was written after them. The recorded inputs prove the coverage.
    const clips = { s1: `${dirs.clipsDir}/a-1.mp4`, s2: `${dirs.clipsDir}/a-2.mp4` };
    const mergedPath = `${dirs.mergedDir}/a-merged.mp4`;
    const manifest: PatchExportManifest = {
      version: 1,
      files: {
        [sourcePath]: {
          signature: 'sig',
          segments: {
            s1: { start: 0, end: 10, path: clips.s1, signature: 'sig' },
            s2: { start: 20, end: 30, path: clips.s2, signature: 'sig' },
          },
          merged: {
            signature: 'msig',
            path: mergedPath,
            inputs: [
              { segId: 's1', start: 0, end: 10, signature: 'sig' },
              { segId: 's2', start: 20, end: 30, signature: 'sig' },
            ],
          },
        },
      },
    };
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'auto' }, {
      readManifest: async () => manifest,
      stat: stats({ [sourcePath]: 100, [mergedPath]: 1, [clips.s1]: 40, [clips.s2]: 50 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.mergedCoversClips).toBe(true);
    expect(preview.warnings).toStrictEqual([]);
  });

  it('does not trust a merge whose cut result was changed afterwards', async () => {
    const clipPath = `${dirs.clipsDir}/a-1.mp4`;
    const mergedPath = `${dirs.mergedDir}/a-merged.mp4`;
    const manifest: PatchExportManifest = {
      version: 1,
      files: {
        [sourcePath]: {
          signature: 'sig',
          // The result was cut again after the merge: another time range and another signature.
          segments: { s1: { start: 0, end: 12, path: clipPath, signature: 'sig2' } },
          merged: { signature: 'msig', path: mergedPath, inputs: [{ segId: 's1', start: 0, end: 10, signature: 'sig' }] },
        },
      },
    };
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'auto' }, {
      readManifest: async () => manifest,
      // The merged file is newer than the result: the timestamps alone would allow the delete.
      stat: stats({ [sourcePath]: 100, [mergedPath]: 90, [clipPath]: 40 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.mergedCoversClips).toBe(false);
    expect(preview.warnings).toStrictEqual(['merged-stale']);
  });

  it('falls back to the timestamps for a merge recorded without inputs', async () => {
    const clipPath = `${dirs.clipsDir}/a-1.mp4`;
    const mergedPath = `${dirs.mergedDir}/a-merged.mp4`;

    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'auto' }, {
      readManifest: async () => manifestWith({ merged: { path: mergedPath }, clips: { s1: clipPath } }),
      // `stats` returns the size as the timestamp: 90 for the merge, 100 for the newer result.
      stat: stats({ [sourcePath]: 100, [mergedPath]: 90, [clipPath]: 100 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.mergedCoversClips).toBe(false);
    expect(preview.warnings).toStrictEqual(['merged-stale']);
  });

  it('carries the segments of the merged result, in merge order', async () => {
    const manifest: PatchExportManifest = {
      version: 1,
      files: {
        [sourcePath]: {
          signature: 'sig',
          segments: {
            s1: { start: 20, end: 30, path: `${dirs.clipsDir}/a-1.mp4`, signature: 'sig' },
            s2: { start: 0, end: 10, path: `${dirs.clipsDir}/a-2.mp4`, signature: 'sig' },
          },
          merged: {
            signature: 'msig',
            path: `${dirs.mergedDir}/a-merged.mp4`,
            chapters: [
              { segId: 's2', start: 0, end: 10, name: '', segColorIndex: 0 },
              { segId: 's1', start: 10, end: 20, name: '', segColorIndex: 1 },
            ],
          },
        },
      },
    };
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'auto' }, {
      readManifest: async () => manifest,
      stat: stats({
        [sourcePath]: 100,
        [`${dirs.clipsDir}/a-1.mp4`]: 40,
        [`${dirs.clipsDir}/a-2.mp4`]: 50,
        [`${dirs.mergedDir}/a-merged.mp4`]: 90,
      }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.mergedSegIds).toStrictEqual(['s2', 's1']);
    expect(preview.clips.map((clip) => clip.segId)).toStrictEqual(['s2', 's1']);
  });

  it('lists the cut results a finished job kept, next to the ones of the last export', async () => {
    // The last export only selected `s3` (its order), but an earlier pass kept `s1`/`s2` in the
    // work area (`clips: keep`). The finish dialog has to see all three, or the kept ones would
    // never be moved out and the work area could never be cleaned.
    const manifest: PatchExportManifest = {
      version: 1,
      files: {
        [sourcePath]: {
          signature: 'sig',
          order: ['s3'],
          segments: {
            s1: { start: 0, end: 10, path: `${dirs.clipsDir}/a-1.mp4`, signature: 'sig' },
            s2: { start: 10, end: 20, path: `${dirs.clipsDir}/a-2.mp4`, signature: 'sig' },
            s3: { start: 20, end: 30, path: `${dirs.clipsDir}/a-3.mp4`, signature: 'sig' },
          },
        },
      },
    };
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      readManifest: async () => manifest,
      stat: stats({
        [sourcePath]: 100,
        [`${dirs.clipsDir}/a-1.mp4`]: 10,
        [`${dirs.clipsDir}/a-2.mp4`]: 20,
        [`${dirs.clipsDir}/a-3.mp4`]: 30,
      }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    // The recorded order comes first (the merge order the user sees), then the rest by time.
    expect(preview.clips.map((clip) => clip.segId)).toStrictEqual(['s3', 's1', 's2']);
    expect(preview.clipsTotalSize).toBe(60);
  });

  it('checks the merge coverage against this export, not the results of earlier passes', async () => {
    // The last export selected only `s3`; an earlier pass kept `s1`/`s2` in the work area. The merge
    // was built from `s3` only, so it covers exactly what this job would delete: the earlier results
    // are handled by their own choice and must not make the merge look stale.
    const manifest: PatchExportManifest = {
      version: 1,
      files: {
        [sourcePath]: {
          signature: 'sig',
          order: ['s3'],
          segments: {
            s1: { start: 0, end: 10, path: `${dirs.clipsDir}/a-1.mp4`, signature: 'sig' },
            s2: { start: 10, end: 20, path: `${dirs.clipsDir}/a-2.mp4`, signature: 'sig' },
            s3: { start: 20, end: 30, path: `${dirs.clipsDir}/a-3.mp4`, signature: 'sig' },
          },
          merged: {
            signature: 'msig',
            path: `${dirs.mergedDir}/a-merged.mp4`,
            inputs: [{ segId: 's3', start: 20, end: 30, signature: 'sig' }],
          },
        },
      },
    };
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'merge' }, {
      readManifest: async () => manifest,
      stat: stats({
        [sourcePath]: 100,
        [`${dirs.clipsDir}/a-1.mp4`]: 10,
        [`${dirs.clipsDir}/a-2.mp4`]: 20,
        [`${dirs.clipsDir}/a-3.mp4`]: 30,
        [`${dirs.mergedDir}/a-merged.mp4`]: 90,
      }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.selectedSegIds).toStrictEqual(['s3']);
    // Unscoped it would be false: one input against three tracked results.
    expect(preview.mergedCoversClips).toBe(true);
  });

  it('counts only a missing result of this export, not one of an earlier pass', async () => {
    const manifestWithOrder: PatchExportManifest = {
      version: 1,
      files: {
        [sourcePath]: {
          signature: 'sig',
          order: ['s2'],
          segments: {
            s1: { start: 0, end: 10, path: `${dirs.clipsDir}/a-1.mp4`, signature: 'sig' },
            s2: { start: 10, end: 20, path: `${dirs.clipsDir}/a-2.mp4`, signature: 'sig' },
          },
        },
      },
    };
    // `s1` (an earlier pass) is gone, `s2` (this export) is there: nothing of this export is lost.
    const staleMissing = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      readManifest: async () => manifestWithOrder,
      stat: stats({ [sourcePath]: 100, [`${dirs.clipsDir}/a-2.mp4`]: 20 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });
    expect(staleMissing.missingClipCount).toBe(1);
    expect(staleMissing.missingSelectedClipCount).toBe(0);
    // `s2` (this export) is gone, `s1` is there: the job would lose this export's output record.
    const selectedMissing = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      readManifest: async () => manifestWithOrder,
      stat: stats({ [sourcePath]: 100, [`${dirs.clipsDir}/a-1.mp4`]: 10 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });
    expect(selectedMissing.missingClipCount).toBe(1);
    expect(selectedMissing.missingSelectedClipCount).toBe(1);
  });

  it('falls back to the cut job without a merged result and reports the missing pieces', async () => {
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'auto' }, {
      readManifest: async () => emptyPatchExportManifest(),
      stat: stats({ [sourcePath]: 100 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.mode).toBe('cut');
    expect(preview.hasRecord).toBe(false);
    expect(preview.warnings).toStrictEqual(['no-record']);
  });

  it('flags a stale merge, a missing source and a missing merged file', async () => {
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'merge' }, {
      readManifest: async () => manifestWith({ merged: { path: `${dirs.mergedDir}/a-merged.mp4` }, clips: { s1: `${dirs.clipsDir}/a-1.mp4` } }),
      stat: stats({ [sourcePath]: 100, [`${dirs.clipsDir}/a-1.mp4`]: 200 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.mode).toBe('merge');
    expect(preview.merged).toBeUndefined();
    expect(preview.warnings).toStrictEqual(['merged-missing']);
  });

  it('never lists a result outside the work area', async () => {
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      readManifest: async () => manifestWith({ clips: { s1: '/elsewhere/a-1.mp4', s2: `${dirs.clipsDir}/a-2.mp4` } }),
      stat: stats({ [sourcePath]: 100, '/elsewhere/a-1.mp4': 10, [`${dirs.clipsDir}/a-2.mp4`]: 20 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.clips.map((clip) => clip.path)).toStrictEqual([`${dirs.clipsDir}/a-2.mp4`]);
    expect(preview.outsideClipCount).toBe(1);
    expect(preview.missingClipCount).toBe(0);
    expect(preview.warnings).toContain('clips-outside-work-area');
  });

  it('reports a tracked result that is gone from its recorded path', async () => {
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      // a-1 was moved by an earlier attempt (or deleted by hand): the manifest still lists it.
      readManifest: async () => manifestWith({ clips: { s1: `${dirs.clipsDir}/a-1.mp4`, s2: `${dirs.clipsDir}/a-2.mp4` } }),
      stat: stats({ [sourcePath]: 100, [`${dirs.clipsDir}/a-2.mp4`]: 20 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.clips.map((clip) => clip.path)).toStrictEqual([`${dirs.clipsDir}/a-2.mp4`]);
    expect(preview.missingClipCount).toBe(1);
    expect(preview.warnings).toContain('clips-missing');
  });

  it('flags a merged result outside the work area instead of planning to delete it', async () => {
    const outsideMerged = '/elsewhere/a-merged.mp4';
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      readManifest: async () => manifestWith({ merged: { path: outsideMerged }, clips: { s1: `${dirs.clipsDir}/a-1.mp4` } }),
      stat: stats({ [sourcePath]: 100, [outsideMerged]: 90, [`${dirs.clipsDir}/a-1.mp4`]: 40 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.merged?.path).toBe(outsideMerged);
    expect(preview.mergedInsideWorkArea).toBe(false);
    expect(preview.warnings).toContain('merged-outside-work-area');
  });

  it('tells a source that cannot be read from a missing one', async () => {
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      readManifest: async () => emptyPatchExportManifest(),
      stat: async () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); },
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.source).toMatchObject({ exists: false, unreadable: true });
    expect(preview.warnings).toContain('source-unreadable');
    expect(preview.warnings).not.toContain('source-missing');
  });

  it('reports a project file that exists but cannot be read', async () => {
    const projectPath = '/src/a-proj.llc';
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      readManifest: async () => emptyPatchExportManifest(),
      stat: async (path) => {
        if (normalizePath(path) === projectPath) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        if (normalizePath(path) === sourcePath) return { size: 100, mtimeMs: 100 };
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.projectFile).toBeUndefined();
    expect(preview.warnings).toContain('project-unreadable');
  });

  it('leaves an unreadable cut result out of the job and says so', async () => {
    const unreadable = `${dirs.clipsDir}/a-1.mp4`;
    const readable = `${dirs.clipsDir}/a-2.mp4`;
    const files: Record<string, number> = { [sourcePath]: 100, [readable]: 20 };

    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      readManifest: async () => manifestWith({ clips: { s1: unreadable, s2: readable } }),
      stat: async (path) => {
        if (normalizePath(path) === unreadable) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        const size = files[normalizePath(path)];
        if (size == null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return { size, mtimeMs: size };
      },
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.clips.map((clip) => clip.path)).toStrictEqual([readable]);
    expect(preview.warnings).toContain('clips-unreadable');
  });

  it('marks a source that sits inside a work area', async () => {
    // Anything still inside `.losslesscut_work` counts; a kept result in `losslesscut_finished` does not.
    const insidePath = `${dirs.detachedSrcMediaDir}/a.mp4`;
    const preview = await buildPatchFinishPreview({ sourcePath: insidePath, workRoot, mode: 'cut' }, {
      readManifest: async () => emptyPatchExportManifest(),
      stat: stats({ [insidePath]: 100 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });
    expect(preview.source.insideWorkArea).toBe(true);
    expect(preview.warnings).toContain('source-inside-work-area');
  });

  it('scans the work directory for the empty-folder cleanup', async () => {
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      readManifest: async () => emptyPatchExportManifest(),
      stat: stats({ [sourcePath]: 100 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [{ path: 'clips', kind: 'directory' }, { path: 'export-manifest.json', kind: 'file' }],
      caseInsensitive: false,
    });

    expect(preview.workDirEntries).toStrictEqual([{ path: 'clips', kind: 'directory' }, { path: 'export-manifest.json', kind: 'file' }]);
    expect(preview.workDirScanFailed).toBe(false);
  });

  it('disables the work-directory cleanup when the scan fails', async () => {
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      readManifest: async () => emptyPatchExportManifest(),
      stat: stats({ [sourcePath]: 100 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); },
      caseInsensitive: false,
    });

    expect(preview.workDirScanFailed).toBe(true);
    expect(preview.workDirEntries).toStrictEqual([]);
    expect(preview.warnings).toContain('work-dir-unreadable');
  });

  it('treats a missing work directory as empty', async () => {
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'cut' }, {
      readManifest: async () => emptyPatchExportManifest(),
      stat: stats({ [sourcePath]: 100 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
      caseInsensitive: false,
    });

    expect(preview.workDirScanFailed).toBe(false);
    expect(preview.workDirEntries).toStrictEqual([]);
    expect(preview.warnings).not.toContain('work-dir-unreadable');
  });

  it('uses the default options of the mode it resolved', () => {
    expect(defaultPatchFinishMergeOptions.source).toBe('detached');
    expect(defaultPatchFinishCutOptions.mergedResult).toBe('finished');
    expect(defaultPatchFinishDiscardOptions.results).toBe('delete');
  });

  it('keeps the discard mode when the dialog asked for it', async () => {
    const preview = await buildPatchFinishPreview({ sourcePath, workRoot, mode: 'discard' }, {
      readManifest: async () => manifestWith({ clips: { s1: `${dirs.clipsDir}/a-1.mp4` } }),
      stat: stats({ [sourcePath]: 100, [`${dirs.clipsDir}/a-1.mp4`]: 40 }),
      getDirs: () => dirs,
      getProjectStores: async () => projectStores,
      scanWorkDir: async () => [],
      caseInsensitive: false,
    });

    expect(preview.mode).toBe('discard');
    expect(preview.clips).toHaveLength(1);
  });
});
