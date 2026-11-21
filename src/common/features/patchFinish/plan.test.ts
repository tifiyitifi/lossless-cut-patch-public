// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchFinishCutOptions, PatchFinishMergeOptions } from './options.js';
import { defaultPatchFinishCutOptions, defaultPatchFinishDiscardOptions, defaultPatchFinishMergeOptions, parsePatchFinishCutOptions, parsePatchFinishDiscardOptions, parsePatchFinishMergeOptions, resolveProjectChoiceOnOpen, withProjectChoiceOnOpen } from './options.js';
import type { PatchFinishPreview } from './preview.js';
import { buildFinishSteps, countCutResultsLeftInWorkArea, getFinishOptionProblems, getFinishTouchedPaths, getPermanentDeleteCount, getPermanentDeleteSize, isPermanentDelete, keepsCutResults, leavesCutResultsInWorkArea, resolveFinishMode, resolveFinishWindowKind, resolveFinishWindowMode, resolveSourceChoice } from './plan.js';
import { resolveFinishPreset } from './presets.js';

const preview = (overrides: Partial<PatchFinishPreview> = {}): PatchFinishPreview => ({
  mode: 'merge',
  source: { path: 'C:/src/a.mp4', size: 100, exists: true, unreadable: false, insideWorkArea: false, dir: 'C:/src' },
  projectFile: { path: 'C:/src/a-proj.llc' },
  merged: { path: 'C:/work/.losslesscut_work/merged/a-merged.mp4', size: 90, mtimeMs: 200 },
  mergedInsideWorkArea: true,
  clips: [
    { path: 'C:/work/.losslesscut_work/clips/a-1.mp4', size: 40, mtimeMs: 100 },
    { path: 'C:/work/.losslesscut_work/clips/a-2.mp4', size: 50, mtimeMs: 110 },
  ],
  clipsTotalSize: 90,
  outsideClipCount: 0,
  missingClipCount: 0,
  missingSelectedClipCount: 0,
  filesInUse: [],
  mergedCoversClips: true,
  hasRecord: true,
  dirs: {
    workDir: 'C:/work/.losslesscut_work',
    clipsDir: 'C:/work/.losslesscut_work/clips',
    mergedDir: 'C:/work/.losslesscut_work/merged',
    finishedSrcMediaDir: 'C:/work/losslesscut_finished/finished_src_media',
    finishedSkipSrcMediaDir: 'C:/work/losslesscut_finished/finished_skip_src',
    detachedSrcMediaDir: 'C:/work/.losslesscut_work/detached_src_media',
    finishedMergedDir: 'C:/work/losslesscut_finished/finished_merged',
    finishedClipsDir: 'C:/work/losslesscut_finished/finished_clips',
    detachedClipsDir: 'C:/work/.losslesscut_work/detached_clips',
    detachedMergedDir: 'C:/work/.losslesscut_work/detached_merged',
    finishLlcDir: 'C:/work/losslesscut_finished/finish_llc',
  },
  workDirEntries: [],
  workDirScanFailed: false,
  projectStores: {
    userDataLlcDir: 'C:/Users/u/AppData/Roaming/LosslessCut/llc',
    installLlcDir: 'C:/Program Files/LosslessCut/llc',
    installLlcWritable: true,
  },
  warnings: [],
  ...overrides,
});

describe('resolveFinishMode', () => {
  it('picks the merge job when the source has a merged result', () => {
    expect(resolveFinishMode('auto', { hasMerged: true })).toBe('merge');
    expect(resolveFinishMode('auto', { hasMerged: false })).toBe('cut');
    expect(resolveFinishMode('cut', { hasMerged: true })).toBe('cut');
    expect(resolveFinishMode('merge', { hasMerged: false })).toBe('merge');
  });
});

describe('resolveFinishWindowMode', () => {
  it('ends with the cut results in the cutting window and in the cut-results window', () => {
    expect(resolveFinishWindowMode('auto', { windowKind: 'cutting' })).toBe('cut');
    expect(resolveFinishWindowMode('auto', { windowKind: 'cut-results' })).toBe('cut');
  });

  it('ends with the merge in the merged-result window', () => {
    expect(resolveFinishWindowMode('auto', { windowKind: 'merged' })).toBe('merge');
  });

  it('keeps an explicit request as pressed, whatever the window', () => {
    expect(resolveFinishWindowMode('merge', { windowKind: 'cutting' })).toBe('merge');
    expect(resolveFinishWindowMode('merge', { windowKind: 'cut-results' })).toBe('merge');
    expect(resolveFinishWindowMode('cut', { windowKind: 'merged' })).toBe('cut');
    expect(resolveFinishWindowMode('discard', { windowKind: 'cut-results' })).toBe('discard');
  });
});

describe('resolveFinishWindowKind', () => {
  it('tells the three windows apart', () => {
    expect(resolveFinishWindowKind({ playerMode: false, mergedMode: false })).toBe('cutting');
    expect(resolveFinishWindowKind({ playerMode: true, mergedMode: false })).toBe('cut-results');
    expect(resolveFinishWindowKind({ playerMode: true, mergedMode: true })).toBe('merged');
  });
});

describe('resolveSourceChoice', () => {
  it('forces the source to finished_src_media when the merged result takes its name', () => {
    const options: PatchFinishMergeOptions = { ...defaultPatchFinishMergeOptions, source: 'keep', merged: 'source-rename' };
    expect(resolveSourceChoice('merge', options)).toBe('finished');
    expect(resolveSourceChoice('cut', { ...defaultPatchFinishCutOptions, source: 'keep' })).toBe('keep');
  });

  it('keeps the skipped-sources choice, which is not forced anywhere', () => {
    expect(resolveSourceChoice('merge', { ...defaultPatchFinishMergeOptions, source: 'skip' })).toBe('skip');
    expect(resolveSourceChoice('cut', { ...defaultPatchFinishCutOptions, source: 'skip' })).toBe('skip');
  });
});

describe('buildFinishSteps', () => {
  it('moves the source first, then the merged result, then deletes the cut results', () => {
    const steps = buildFinishSteps({
      mode: 'merge',
      options: { ...defaultPatchFinishMergeOptions, projectFile: 'follow' },
      preview: preview(),
    });
    expect(steps).toStrictEqual([
      { kind: 'move-source', target: 'detached' },
      { kind: 'move-merged', target: 'finished' },
      { kind: 'delete-clips' },
    ]);
  });

  it('archives the project file into the installation store by default', () => {
    const steps = buildFinishSteps({ mode: 'merge', options: defaultPatchFinishMergeOptions, preview: preview() });
    expect(steps).toStrictEqual([
      { kind: 'move-source', target: 'detached' },
      { kind: 'move-project' },
      { kind: 'move-merged', target: 'finished' },
      { kind: 'delete-clips' },
    ]);
  });

  it('keeps the source when asked, and skips the merged step without a merged result', () => {
    const steps = buildFinishSteps({
      mode: 'merge',
      options: { ...defaultPatchFinishMergeOptions, source: 'keep', clips: 'detached', projectFile: 'follow' },
      preview: preview({ merged: undefined }),
    });
    expect(steps).toStrictEqual([{ kind: 'move-clips', target: 'detached' }]);
  });

  it('moves the cut results to detached_clips instead of deleting them when the merge is stale', () => {
    const steps = buildFinishSteps({ mode: 'merge', options: defaultPatchFinishMergeOptions, preview: preview({ mergedCoversClips: false }) });
    expect(steps).toContainEqual({ kind: 'move-clips', target: 'detached' });
    expect(steps).not.toContainEqual({ kind: 'delete-clips' });
  });

  it('keeps the cut results where they are when asked, and never plans a step for them', () => {
    // A merge job that only ends the job: the merged result leaves, the results stay for the next
    // pass, so no clip step exists at all.
    const steps = buildFinishSteps({
      mode: 'merge',
      options: { ...defaultPatchFinishMergeOptions, source: 'keep', projectFile: 'keep', clips: 'keep' },
      preview: preview(),
    });
    expect(steps).toStrictEqual([{ kind: 'move-merged', target: 'finished' }]);

    // The cut job: keeping the results leaves nothing to move (the merged result is not deleted).
    const cutSteps = buildFinishSteps({
      mode: 'cut',
      options: { ...defaultPatchFinishCutOptions, source: 'keep', projectFile: 'keep', clips: 'keep', mergedResult: 'keep' },
      preview: preview(),
    });
    expect(cutSteps).toStrictEqual([]);
  });

  it('runs the cut-only job: moves the merged result to finished_merged by default', () => {
    const options: PatchFinishCutOptions = { ...defaultPatchFinishCutOptions, source: 'finished', clips: 'source', mergedResult: 'keep', projectFile: 'follow' };
    expect(buildFinishSteps({ mode: 'cut', options, preview: preview() })).toStrictEqual([
      { kind: 'move-source', target: 'finished' },
      { kind: 'move-clips', target: 'source' },
    ]);
    expect(buildFinishSteps({ mode: 'cut', options: { ...options, mergedResult: 'finished' }, preview: preview() })).toStrictEqual([
      { kind: 'move-source', target: 'finished' },
      { kind: 'move-merged', target: 'finished' },
      { kind: 'move-clips', target: 'source' },
    ]);
    expect(buildFinishSteps({ mode: 'cut', options: { ...options, mergedResult: 'delete' }, preview: preview() })).toStrictEqual([
      { kind: 'move-source', target: 'finished' },
      { kind: 'delete-merged' },
      { kind: 'move-clips', target: 'source' },
    ]);
  });

  it('moves a merged result outside the work area too (only a delete needs the work area)', () => {
    const options: PatchFinishCutOptions = { ...defaultPatchFinishCutOptions, source: 'keep', clips: 'keep', projectFile: 'keep' };
    expect(buildFinishSteps({ mode: 'cut', options, preview: preview({ mergedInsideWorkArea: false }) })).toStrictEqual([
      { kind: 'move-merged', target: 'finished' },
    ]);
  });

  it('moves a skipped source out without touching its results', () => {
    const steps = buildFinishSteps({
      mode: 'cut',
      options: { ...defaultPatchFinishCutOptions, source: 'skip', projectFile: 'follow' },
      preview: preview({ clips: [], merged: undefined }),
    });
    expect(steps).toStrictEqual([{ kind: 'move-source', target: 'skip' }]);
  });

  it('never plans a delete of a merged result outside the work area', () => {
    const options: PatchFinishCutOptions = { ...defaultPatchFinishCutOptions, source: 'keep', clips: 'source', mergedResult: 'delete', projectFile: 'follow' };
    const outside = preview({ mergedInsideWorkArea: false });
    expect(buildFinishSteps({ mode: 'cut', options, preview: outside })).toStrictEqual([{ kind: 'move-clips', target: 'source' }]);
    expect(getPermanentDeleteCount({ mode: 'cut', options, preview: outside })).toBe(0);
    expect(getPermanentDeleteCount({ mode: 'cut', options, preview: preview() })).toBe(1);
  });

  it('adds no step for an empty job', () => {
    expect(buildFinishSteps({
      mode: 'merge',
      options: { ...defaultPatchFinishMergeOptions, source: 'keep', projectFile: 'keep' },
      preview: preview({ merged: undefined, clips: [] }),
    })).toStrictEqual([]);
  });

  it('archives the project file even when the source stays put', () => {
    const steps = buildFinishSteps({
      mode: 'merge',
      options: { ...defaultPatchFinishMergeOptions, source: 'keep', projectFile: 'finish-llc', clips: 'detached' },
      preview: preview({ merged: undefined }),
    });
    expect(steps).toStrictEqual([
      { kind: 'move-project' },
      { kind: 'move-clips', target: 'detached' },
    ]);
  });

  it('keeps the project travel inside the source step when it follows the video', () => {
    expect(buildFinishSteps({
      mode: 'merge',
      options: { ...defaultPatchFinishMergeOptions, source: 'detached', projectFile: 'follow' },
      preview: preview({ merged: undefined, clips: [] }),
    })).toStrictEqual([{ kind: 'move-source', target: 'detached' }]);
  });
});

describe('finish options', () => {
  it('flags what makes the job unusable', () => {
    expect(getFinishOptionProblems({ mode: 'merge', options: defaultPatchFinishMergeOptions, preview: preview() })).toStrictEqual([]);
    expect(getFinishOptionProblems({ mode: 'merge', options: { ...defaultPatchFinishMergeOptions, source: 'keep', projectFile: 'keep' }, preview: preview({ merged: undefined, clips: [] }) }))
      .toStrictEqual(['merged-required', 'nothing-to-do']);
    expect(getFinishOptionProblems({
      mode: 'merge',
      options: defaultPatchFinishMergeOptions,
      preview: preview({ mergedCoversClips: false, source: { ...preview().source, exists: false, insideWorkArea: true } }),
    }))
      .toStrictEqual(['source-missing', 'source-inside-work-area', 'clips-delete-unsafe']);
    // A source that is there but cannot be read is not reported as gone.
    expect(getFinishOptionProblems({
      mode: 'merge',
      options: defaultPatchFinishMergeOptions,
      preview: preview({ source: { ...preview().source, exists: false, unreadable: true } }),
    })).toStrictEqual(['source-unreadable']);
    // A result of this export missing from its recorded path while others remain: blocked, because
    // the job would write a project file without it.
    expect(getFinishOptionProblems({
      mode: 'merge',
      options: defaultPatchFinishMergeOptions,
      preview: preview({ missingClipCount: 1, missingSelectedClipCount: 1 }),
    })).toStrictEqual(['clips-missing']);
    // A missing result of an earlier pass is never moved by this job (deleted or kept as a whole),
    // so it drops no record and must not block the finish.
    expect(getFinishOptionProblems({
      mode: 'merge',
      options: defaultPatchFinishMergeOptions,
      preview: preview({ missingClipCount: 1, missingSelectedClipCount: 0 }),
    })).toStrictEqual([]);
    // Nothing left to move means nothing to lose: the merged job may still finish.
    expect(getFinishOptionProblems({
      mode: 'merge',
      options: defaultPatchFinishMergeOptions,
      preview: preview({ missingClipCount: 1, missingSelectedClipCount: 1, clips: [] }),
    })).toStrictEqual([]);
  });

  it('blocks a job that would move a file another window plays', () => {
    const clipPath = 'C:/work/.losslesscut_work/clips/a-1.mp4';
    expect(getFinishOptionProblems({
      mode: 'merge',
      options: defaultPatchFinishMergeOptions,
      preview: preview({ filesInUse: [clipPath] }),
    })).toStrictEqual(['files-in-use']);

    // The merged result is moved by a merge job, so playing it blocks too.
    expect(getFinishOptionProblems({
      mode: 'merge',
      options: defaultPatchFinishMergeOptions,
      preview: preview({ filesInUse: ['C:/work/.losslesscut_work/merged/a-merged.mp4'] }),
    })).toStrictEqual(['files-in-use']);

    // A cut job that keeps the merged result does not touch it: the player may keep playing it.
    expect(getFinishOptionProblems({
      mode: 'cut',
      options: { ...defaultPatchFinishCutOptions, mergedResult: 'keep' },
      preview: preview({ filesInUse: ['C:/work/.losslesscut_work/merged/a-merged.mp4'] }),
    })).toStrictEqual([]);

    // ... but it does move the clips.
    expect(getFinishOptionProblems({
      mode: 'cut',
      options: { ...defaultPatchFinishCutOptions, mergedResult: 'keep' },
      preview: preview({ filesInUse: [clipPath] }),
    })).toStrictEqual(['files-in-use']);

    // A cut job that moves the merged result to finished_merged touches it, so playing it blocks.
    expect(getFinishOptionProblems({
      mode: 'cut',
      options: defaultPatchFinishCutOptions,
      preview: preview({ filesInUse: ['C:/work/.losslesscut_work/merged/a-merged.mp4'] }),
    })).toStrictEqual(['files-in-use']);
  });

  it('counts the permanent deletions', () => {
    expect(getPermanentDeleteCount({ mode: 'merge', options: defaultPatchFinishMergeOptions, preview: preview() })).toBe(2);
    expect(getPermanentDeleteCount({ mode: 'merge', options: { ...defaultPatchFinishMergeOptions, clips: 'detached' }, preview: preview() })).toBe(0);
    // A stale merged result moves the cut results aside instead of deleting them: the confirmation
    // must not promise a permanent delete (the same rule `buildFinishSteps` uses).
    expect(getPermanentDeleteCount({ mode: 'merge', options: defaultPatchFinishMergeOptions, preview: preview({ mergedCoversClips: false }) })).toBe(0);
    // The cut job moves a merged result to finished_merged by default: nothing is deleted permanently.
    expect(getPermanentDeleteCount({ mode: 'cut', options: defaultPatchFinishCutOptions, preview: preview() })).toBe(0);
    expect(getPermanentDeleteCount({ mode: 'cut', options: { ...defaultPatchFinishCutOptions, mergedResult: 'delete' }, preview: preview() })).toBe(1);
    expect(getPermanentDeleteCount({ mode: 'cut', options: { ...defaultPatchFinishCutOptions, mergedResult: 'keep' }, preview: preview() })).toBe(0);
    expect(isPermanentDelete('cut', defaultPatchFinishCutOptions)).toBe(false);
    expect(isPermanentDelete('cut', { ...defaultPatchFinishCutOptions, mergedResult: 'delete' })).toBe(true);
    expect(isPermanentDelete('cut', { ...defaultPatchFinishCutOptions, mergedResult: 'keep' })).toBe(false);
  });

  it('counts the bytes actually freed, the same files as the delete count', () => {
    // Same questions as `getPermanentDeleteCount`: only a file that really leaves frees space.
    expect(getPermanentDeleteSize({ mode: 'merge', options: defaultPatchFinishMergeOptions, preview: preview() })).toBe(90);
    expect(getPermanentDeleteSize({ mode: 'merge', options: { ...defaultPatchFinishMergeOptions, clips: 'detached' }, preview: preview() })).toBe(0);
    // A stale merge moves the cut results aside instead of deleting them.
    expect(getPermanentDeleteSize({ mode: 'merge', options: defaultPatchFinishMergeOptions, preview: preview({ mergedCoversClips: false }) })).toBe(0);
    // The cut job moves the merged result by default: nothing is freed.
    expect(getPermanentDeleteSize({ mode: 'cut', options: defaultPatchFinishCutOptions, preview: preview() })).toBe(0);
    expect(getPermanentDeleteSize({ mode: 'cut', options: { ...defaultPatchFinishCutOptions, mergedResult: 'delete' }, preview: preview() })).toBe(90);
    expect(getPermanentDeleteSize({ mode: 'cut', options: { ...defaultPatchFinishCutOptions, mergedResult: 'keep' }, preview: preview() })).toBe(0);
  });

  it('flags a project store that is missing or not writable', () => {
    expect(getFinishOptionProblems({
      mode: 'merge',
      options: { ...defaultPatchFinishMergeOptions, projectFile: 'custom' },
      preview: preview(),
    })).toStrictEqual(['project-dir-missing']);

    expect(getFinishOptionProblems({
      mode: 'merge',
      options: { ...defaultPatchFinishMergeOptions, projectFile: 'install-llc' },
      preview: preview({ projectStores: { ...preview().projectStores, installLlcWritable: false } }),
    })).toStrictEqual(['project-dir-unwritable']);

    expect(getFinishOptionProblems({
      mode: 'merge',
      options: { ...defaultPatchFinishMergeOptions, projectFile: 'custom', projectDir: 'D:/llc' },
      preview: preview(),
    })).toStrictEqual([]);

    // Without a project file there is nothing to move, so the store choices cannot block the job.
    expect(getFinishOptionProblems({
      mode: 'cut',
      options: { ...defaultPatchFinishCutOptions, projectFile: 'custom' },
      preview: preview({ mode: 'cut', projectFile: undefined, merged: undefined, clips: [] }),
    })).toStrictEqual([]);
  });

  it('blocks a work-directory cleanup that the prediction says is not possible', () => {
    expect(getFinishOptionProblems({
      mode: 'merge',
      options: { ...defaultPatchFinishMergeOptions, workDir: 'clear' },
      preview: preview(),
      workDirClearable: false,
    })).toStrictEqual(['work-dir-not-clearable']);
    expect(getFinishOptionProblems({
      mode: 'merge',
      options: { ...defaultPatchFinishMergeOptions, workDir: 'clear' },
      preview: preview(),
      workDirClearable: true,
    })).toStrictEqual([]);
  });
});

describe('option parsers', () => {
  it('keeps stored choices and repairs malformed ones', () => {
    expect(parsePatchFinishMergeOptions(undefined)).toStrictEqual(defaultPatchFinishMergeOptions);
    expect(parsePatchFinishMergeOptions({ source: 'keep', clips: 'detached', merged: 'nope', next: 'none', moveProjectFile: false })).toEqual({
      source: 'keep', projectFile: 'keep', projectDateGrouping: 'ym', merged: 'finished', clips: 'detached', deleteStaleClips: false, next: 'none', workDir: 'keep',
    });
    expect(parsePatchFinishCutOptions({ clips: 'source', mergedResult: 'keep', source: 'finished', moveProjectFile: true, next: 'none' }))
      .toEqual({
        source: 'finished',
        projectFile: 'follow',
        projectDateGrouping: 'ym',
        clips: 'source',
        mergedResult: 'keep',
        deleteStaleClips: false,
        next: 'none',
        workDir: 'keep',
        cutRename: defaultPatchFinishCutOptions.cutRename,
      });
    expect(parsePatchFinishMergeOptions({ source: 'skip' }).source).toBe('skip');
    expect(parsePatchFinishCutOptions({ source: 'skip' }).source).toBe('skip');
    // A stored result choice the job may keep (the `loop-video` preset writes it).
    expect(parsePatchFinishMergeOptions({ clips: 'keep' }).clips).toBe('keep');
    expect(parsePatchFinishCutOptions({ clips: 'keep' }).clips).toBe('keep');
    expect(parsePatchFinishMergeOptions({ clips: 'nope' }).clips).toBe(defaultPatchFinishMergeOptions.clips);
    expect(parsePatchFinishCutOptions({ clips: 'nope' }).clips).toBe(defaultPatchFinishCutOptions.clips);
    expect(parsePatchFinishCutOptions({ mergedResult: 'finished' })).toEqual(defaultPatchFinishCutOptions);
    expect(parsePatchFinishCutOptions({ mergedResult: 'delete' }).mergedResult).toBe('delete');
    expect(parsePatchFinishCutOptions({ mergedResult: 'nope' }).mergedResult).toBe(defaultPatchFinishCutOptions.mergedResult);
    expect(parsePatchFinishMergeOptions({ workDir: 'clear' })).toMatchObject({ workDir: 'clear' });
    expect(parsePatchFinishCutOptions({ workDir: 'nope' })).toMatchObject({ workDir: 'keep' });
  });

  it('defaults the project file to the installation folder store', () => {
    expect(defaultPatchFinishMergeOptions.projectFile).toBe('install-llc');
    expect(defaultPatchFinishCutOptions.projectFile).toBe('install-llc');
    expect(parsePatchFinishMergeOptions({}).projectFile).toBe('install-llc');
    expect(parsePatchFinishCutOptions(undefined).projectFile).toBe('install-llc');
  });

  it('opens a read-only installation folder with the app data store', () => {
    expect(resolveProjectChoiceOnOpen({ choice: 'install-llc', installLlcWritable: true })).toBe('install-llc');
    expect(resolveProjectChoiceOnOpen({ choice: 'install-llc', installLlcWritable: false })).toBe('userdata-llc');
    // Every other choice is kept: only the default store depends on the installation folder.
    expect(resolveProjectChoiceOnOpen({ choice: 'follow', installLlcWritable: false })).toBe('follow');
    expect(resolveProjectChoiceOnOpen({ choice: 'keep', installLlcWritable: false })).toBe('keep');

    const options = { ...defaultPatchFinishCutOptions };
    expect(withProjectChoiceOnOpen(options, { installLlcWritable: false })).toStrictEqual({ ...options, projectFile: 'userdata-llc', projectDir: undefined });
    // A folder from an earlier custom choice is not silently reused for the fallback.
    expect(withProjectChoiceOnOpen({ ...options, projectDir: 'D:/old' }, { installLlcWritable: false }))
      .toStrictEqual({ ...options, projectFile: 'userdata-llc', projectDir: undefined });
    // Nothing changed: the same object is returned, so the caller can keep it as it is.
    expect(withProjectChoiceOnOpen(options, { installLlcWritable: true })).toBe(options);
  });

  it('keeps the one-video preset when the installation folder falls back to app data', () => {
    // The dialog's default options and the preset's own safe downgrade must agree, or the row
    // reads "custom" although the options are what `one-video` stands for.
    const cut = withProjectChoiceOnOpen(defaultPatchFinishCutOptions, { installLlcWritable: false });
    expect(resolveFinishPreset({ mode: 'cut', options: cut, mergedCoversClips: true, installLlcWritable: false })).toBe('one-video');
    const merge = withProjectChoiceOnOpen(defaultPatchFinishMergeOptions, { installLlcWritable: false });
    expect(resolveFinishPreset({ mode: 'merge', options: merge, mergedCoversClips: true, installLlcWritable: false })).toBe('one-video');
  });

  it('reads the project store fields and trims the custom folder', () => {
    expect(parsePatchFinishMergeOptions({
      projectFile: 'custom',
      projectDir: '  D:/llc  ',
      projectDateGrouping: 'ymd',
    })).toMatchObject({
      projectFile: 'custom',
      projectDir: 'D:/llc',
      projectDateGrouping: 'ymd',
    });

    // A blank folder is "not chosen yet", not an empty destination.
    expect(parsePatchFinishCutOptions({ projectFile: 'custom', projectDir: ' '.repeat(3) })).toMatchObject({
      projectFile: 'custom',
      projectDir: undefined,
    });

    expect(parsePatchFinishCutOptions({ projectFile: 'nope', projectDateGrouping: 'nope' })).toMatchObject({
      projectFile: 'install-llc',
      projectDateGrouping: 'ym',
    });
  });

  it('migrates the old "split by date" switch and keeps the flat choice', () => {
    // `projectDateFolders: false` used to mean "no date subfolders": that is the `none` grouping now.
    expect(parsePatchFinishMergeOptions({ projectDateFolders: false, projectDateGrouping: 'ymd' })).toMatchObject({ projectDateGrouping: 'none' });
    expect(parsePatchFinishMergeOptions({ projectDateFolders: true, projectDateGrouping: 'ymd' })).toMatchObject({ projectDateGrouping: 'ymd' });
    expect(parsePatchFinishMergeOptions({ projectDateFolders: true })).toMatchObject({ projectDateGrouping: 'ym' });
    expect(parsePatchFinishMergeOptions({ projectDateGrouping: 'none' })).toMatchObject({ projectDateGrouping: 'none' });
  });
});

describe('getFinishTouchedPaths', () => {
  const clipPaths = ['C:/work/.losslesscut_work/clips/a-1.mp4', 'C:/work/.losslesscut_work/clips/a-2.mp4'];

  it('lists the cut results the job moves, whatever the clip choice', () => {
    expect(getFinishTouchedPaths({ mode: 'merge', options: defaultPatchFinishMergeOptions, preview: preview() })).toStrictEqual([
      ...clipPaths,
      'C:/work/.losslesscut_work/merged/a-merged.mp4',
    ]);
    expect(getFinishTouchedPaths({ mode: 'cut', options: defaultPatchFinishCutOptions, preview: preview() })).toStrictEqual([
      ...clipPaths,
      'C:/work/.losslesscut_work/merged/a-merged.mp4',
    ]);
  });

  it('leaves the merged result alone when the job keeps it', () => {
    expect(getFinishTouchedPaths({
      mode: 'cut',
      options: { ...defaultPatchFinishCutOptions, mergedResult: 'keep' },
      preview: preview(),
    })).toStrictEqual(clipPaths);
  });

  it('leaves the cut results alone when the job keeps them', () => {
    // A result another window plays may stay: the job never touches the file.
    expect(getFinishTouchedPaths({
      mode: 'merge',
      options: { ...defaultPatchFinishMergeOptions, clips: 'keep' },
      preview: preview(),
    })).toStrictEqual(['C:/work/.losslesscut_work/merged/a-merged.mp4']);
    expect(getFinishTouchedPaths({
      mode: 'cut',
      options: { ...defaultPatchFinishCutOptions, clips: 'keep', mergedResult: 'keep' },
      preview: preview(),
    })).toStrictEqual([]);
    // The discard flow always settles the results, whatever the stored choice says.
    expect(getFinishTouchedPaths({ mode: 'discard', options: defaultPatchFinishDiscardOptions, preview: preview() })).toContain(clipPaths[0]!);
  });

  it('leaves a merged result outside the work area alone when the job would delete it', () => {
    expect(getFinishTouchedPaths({
      mode: 'cut',
      options: { ...defaultPatchFinishCutOptions, mergedResult: 'delete' },
      preview: preview({ mergedInsideWorkArea: false }),
    })).toStrictEqual(clipPaths);
  });

  it('touches a merged result the cut job moves, wherever it lives', () => {
    expect(getFinishTouchedPaths({
      mode: 'cut',
      options: defaultPatchFinishCutOptions,
      preview: preview({ mergedInsideWorkArea: false }),
    })).toStrictEqual([...clipPaths, 'C:/work/.losslesscut_work/merged/a-merged.mp4']);
  });
});

describe('keepsCutResults', () => {
  it('is true only for the merge and cut choices that leave the results in place', () => {
    expect(keepsCutResults('merge', { ...defaultPatchFinishMergeOptions, clips: 'keep' })).toBe(true);
    expect(keepsCutResults('merge', { ...defaultPatchFinishMergeOptions, clips: 'delete' })).toBe(false);
    expect(keepsCutResults('cut', { ...defaultPatchFinishCutOptions, clips: 'keep' })).toBe(true);
    expect(keepsCutResults('cut', { ...defaultPatchFinishCutOptions, clips: 'finished' })).toBe(false);
    // The discard flow always deletes or parks the results before it parks the source.
    expect(keepsCutResults('discard', defaultPatchFinishDiscardOptions)).toBe(false);
  });
});

describe('discard mode', () => {
  const discardOptions = {
    ...defaultPatchFinishDiscardOptions,
    results: 'delete',
  } as const;

  it('settles the results before parking the source', () => {
    expect(buildFinishSteps({ mode: 'discard', options: discardOptions, preview: preview() })).toStrictEqual([
      { kind: 'delete-clips' },
      { kind: 'delete-merged' },
      { kind: 'move-source', target: 'detached' },
    ]);
    expect(buildFinishSteps({ mode: 'discard', options: { ...discardOptions, results: 'detached' }, preview: preview() })).toStrictEqual([
      { kind: 'move-clips', target: 'detached' },
      { kind: 'move-merged', target: 'detached' },
      { kind: 'move-source', target: 'detached' },
    ]);
  });

  it('never deletes a merged result outside the work area, but may move it', () => {
    const outside = preview({ mergedInsideWorkArea: false });
    expect(buildFinishSteps({ mode: 'discard', options: discardOptions, preview: outside })).toStrictEqual([
      { kind: 'delete-clips' },
      { kind: 'delete-merged' },
      { kind: 'move-source', target: 'detached' },
    ]);
    expect(buildFinishSteps({ mode: 'discard', options: { ...discardOptions, results: 'detached' }, preview: outside })).toStrictEqual([
      { kind: 'move-clips', target: 'detached' },
      { kind: 'move-merged', target: 'detached' },
      { kind: 'move-source', target: 'detached' },
    ]);
  });

  it('always parks the source and treats results as the permanent-delete switch', () => {
    expect(resolveSourceChoice('discard', discardOptions)).toBe('detached');
    expect(isPermanentDelete('discard', discardOptions)).toBe(true);
    expect(isPermanentDelete('discard', { ...discardOptions, results: 'detached' })).toBe(false);
    expect(getPermanentDeleteCount({ mode: 'discard', options: discardOptions, preview: preview() })).toBe(3);
    expect(getPermanentDeleteCount({ mode: 'discard', options: { ...discardOptions, results: 'detached' }, preview: preview() })).toBe(0);
    expect(getPermanentDeleteCount({ mode: 'discard', options: discardOptions, preview: preview({ mergedInsideWorkArea: false }) })).toBe(2);
    // The size follows the count: a merged result outside the work area is not deleted, so it is
    // not reported as freed space either.
    expect(getPermanentDeleteSize({ mode: 'discard', options: discardOptions, preview: preview() })).toBe(180);
    expect(getPermanentDeleteSize({ mode: 'discard', options: { ...discardOptions, results: 'detached' }, preview: preview() })).toBe(0);
    expect(getPermanentDeleteSize({ mode: 'discard', options: discardOptions, preview: preview({ mergedInsideWorkArea: false }) })).toBe(90);
  });

  it('touches the results a player may hold open', () => {
    // Deleting skips a merged result outside the work area, so it is not "in use" for this job.
    const outside = preview({ mergedInsideWorkArea: false });
    expect(getFinishTouchedPaths({ mode: 'discard', options: discardOptions, preview: outside })).toStrictEqual([
      'C:/work/.losslesscut_work/clips/a-1.mp4',
      'C:/work/.losslesscut_work/clips/a-2.mp4',
    ]);
    expect(getFinishTouchedPaths({ mode: 'discard', options: { ...discardOptions, results: 'detached' }, preview: outside })).toStrictEqual([
      'C:/work/.losslesscut_work/clips/a-1.mp4',
      'C:/work/.losslesscut_work/clips/a-2.mp4',
      'C:/work/.losslesscut_work/merged/a-merged.mp4',
    ]);
  });

  it('parses the stored options and falls back to asking on bad input', () => {
    expect(parsePatchFinishDiscardOptions(undefined)).toStrictEqual(defaultPatchFinishDiscardOptions);
    expect(parsePatchFinishDiscardOptions({ results: 'detached', next: 'none' })).toStrictEqual({
      ...defaultPatchFinishDiscardOptions,
      results: 'detached',
      next: 'none',
    });
    expect(parsePatchFinishDiscardOptions({ results: 'nonsense' }).results).toBe('delete');
    // The fixed choices cannot be edited through the stored value.
    expect(parsePatchFinishDiscardOptions({ source: 'finished', projectFile: 'keep' })).toMatchObject({ source: 'detached', projectFile: 'follow' });
  });
});

describe('stale cut results (the results of earlier passes)', () => {
  const clip1 = 'C:/work/.losslesscut_work/clips/a-1.mp4';
  const clip2 = 'C:/work/.losslesscut_work/clips/a-2.mp4';
  const staleClip = 'C:/work/.losslesscut_work/clips/old-1.mp4';
  const stalePreview = (overrides: Partial<PatchFinishPreview> = {}): PatchFinishPreview => preview({
    clips: [
      { path: clip1, size: 40, mtimeMs: 100, segId: 'a' },
      { path: clip2, size: 50, mtimeMs: 110, segId: 'b' },
      { path: staleClip, size: 30, mtimeMs: 90, segId: 'old' },
    ],
    selectedSegIds: ['a', 'b'],
    ...overrides,
  });

  it('moves this export\'s results and deletes the stale ones when the choice is on', () => {
    const options: PatchFinishCutOptions = { ...defaultPatchFinishCutOptions, source: 'keep', projectFile: 'keep', mergedResult: 'keep' };
    expect(buildFinishSteps({ mode: 'cut', options, preview: stalePreview() })).toStrictEqual([
      { kind: 'move-clips', target: 'finished', clipPaths: [clip1, clip2] },
      { kind: 'delete-stale-clips', clipPaths: [staleClip] },
    ]);
  });

  it('leaves the stale results alone when the choice is off', () => {
    const options: PatchFinishCutOptions = { ...defaultPatchFinishCutOptions, source: 'keep', projectFile: 'keep', mergedResult: 'keep', deleteStaleClips: false };
    expect(buildFinishSteps({ mode: 'cut', options, preview: stalePreview() })).toStrictEqual([
      { kind: 'move-clips', target: 'finished', clipPaths: [clip1, clip2] },
    ]);
  });

  it('handles stale results the same way in a merge job', () => {
    const options: PatchFinishMergeOptions = { ...defaultPatchFinishMergeOptions, source: 'keep', projectFile: 'keep', clips: 'keep' };
    expect(buildFinishSteps({ mode: 'merge', options, preview: stalePreview() })).toStrictEqual([
      { kind: 'move-merged', target: 'finished' },
      { kind: 'delete-stale-clips', clipPaths: [staleClip] },
    ]);
  });

  it('touches the stale results only when it deletes them', () => {
    const options: PatchFinishCutOptions = { ...defaultPatchFinishCutOptions, clips: 'keep', mergedResult: 'keep' };
    expect(getFinishTouchedPaths({ mode: 'cut', options, preview: stalePreview() })).toStrictEqual([staleClip]);
    expect(getFinishTouchedPaths({ mode: 'cut', options: { ...options, deleteStaleClips: false }, preview: stalePreview() })).toStrictEqual([]);
  });

  it('counts the stale deletions in the permanent-delete count', () => {
    const options: PatchFinishCutOptions = { ...defaultPatchFinishCutOptions, mergedResult: 'keep' };
    expect(getPermanentDeleteCount({ mode: 'cut', options, preview: stalePreview() })).toBe(1);
    expect(getPermanentDeleteCount({ mode: 'cut', options: { ...options, deleteStaleClips: false }, preview: stalePreview() })).toBe(0);
    // The size follows the same choice: only the stale clip that is deleted frees space.
    expect(getPermanentDeleteSize({ mode: 'cut', options, preview: stalePreview() })).toBe(30);
    expect(getPermanentDeleteSize({ mode: 'cut', options: { ...options, deleteStaleClips: false }, preview: stalePreview() })).toBe(0);
  });

  it('keeps the manifest record when the stale results stay', () => {
    const options: PatchFinishCutOptions = { ...defaultPatchFinishCutOptions, source: 'keep', projectFile: 'keep', mergedResult: 'keep' };
    expect(leavesCutResultsInWorkArea({ mode: 'cut', options, preview: stalePreview() })).toBe(false);
    expect(leavesCutResultsInWorkArea({ mode: 'cut', options: { ...options, deleteStaleClips: false }, preview: stalePreview() })).toBe(true);
    expect(leavesCutResultsInWorkArea({ mode: 'cut', options: { ...options, clips: 'keep' }, preview: stalePreview() })).toBe(true);
    expect(countCutResultsLeftInWorkArea({ mode: 'cut', options: { ...options, deleteStaleClips: false }, preview: stalePreview() })).toBe(1);
    expect(countCutResultsLeftInWorkArea({ mode: 'cut', options, preview: stalePreview() })).toBe(0);
  });

  it('treats nothing as stale without a recorded export order', () => {
    const options: PatchFinishCutOptions = { ...defaultPatchFinishCutOptions, source: 'keep', projectFile: 'keep', mergedResult: 'keep' };
    const noOrder = stalePreview({ selectedSegIds: undefined });
    expect(buildFinishSteps({ mode: 'cut', options, preview: noOrder })).toStrictEqual([
      { kind: 'move-clips', target: 'finished' },
    ]);
  });

  it('reads the old stored options from the next choice', () => {
    // Options written before the field existed expressed the intent through `next`.
    expect(parsePatchFinishCutOptions({ next: 'none' }).deleteStaleClips).toBe(false);
    expect(parsePatchFinishCutOptions({ next: 'next' }).deleteStaleClips).toBe(true);
    expect(parsePatchFinishMergeOptions({ next: 'none' }).deleteStaleClips).toBe(false);
    expect(parsePatchFinishCutOptions({ deleteStaleClips: true, next: 'none' }).deleteStaleClips).toBe(true);
  });
});
