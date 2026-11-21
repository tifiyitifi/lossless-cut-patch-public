// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchFinishCutOptions } from './options.js';
import { defaultPatchFinishCutOptions, defaultPatchFinishMergeOptions, parsePatchFinishCutOptions } from './options.js';
import type { PatchFinishPreview } from './preview.js';
import { getFinishOptionProblems } from './plan.js';
import type { CutRenamePlanClip } from './cutRename.js';
import { planCutRename, resolveCutRenameFileName } from './cutRename.js';

const clipsDir = 'C:/work/.losslesscut_work/clips';
const finishedClipsDir = 'C:/work/losslesscut_finished/finished_clips';

const clip = (name: string, overrides: Partial<CutRenamePlanClip> = {}): CutRenamePlanClip => ({
  path: `${clipsDir}/${name}`,
  start: 0,
  end: 1,
  ...overrides,
});

const baseParams = {
  sourceName: 'a',
  sourceFolder: 'src',
  targetDir: finishedClipsDir,
  epochMs: Date.UTC(2026, 10, 16, 18, 1, 6, 19),
  labelSeparator: '-',
  maxLabelLength: 500,
  minZeroPadding: 0,
  isWindows: true,
  caseInsensitive: true,
};

describe('planCutRename', () => {
  it('numbers the default finish rule by the results of this job', () => {
    const result = planCutRename({
      ...baseParams,
      rule: '{source}-clip-{seg_num}',
      clips: [clip('a-1.mp4'), clip('a-2.mp4')],
    });

    expect(result).toStrictEqual({
      plan: [
        { from: `${clipsDir}/a-1.mp4`, fileName: 'a-clip-1.mp4' },
        { from: `${clipsDir}/a-2.mp4`, fileName: 'a-clip-2.mp4' },
      ],
    });
  });

  it('gives a single result the plain fixed name', () => {
    const result = planCutRename({ ...baseParams, rule: '{source}-clip', clips: [clip('a-1.mp4')] });

    expect(result).toStrictEqual({ plan: [{ from: `${clipsDir}/a-1.mp4`, fileName: 'a-clip.mp4' }] });
  });

  it('appends the position and the time when a rule names several results the same', () => {
    const result = planCutRename({ ...baseParams, rule: '{source}-clip', clips: [clip('a-1.mp4'), clip('a-2.mp4')] });
    if ('problem' in result) throw new Error('expected a plan');

    // The forced suffix is what the export engine uses: neither result may replace the other.
    expect(result.plan[0]!.fileName).toMatch(/^a-clip - 1-.+\.mp4$/u);
    expect(result.plan[1]!.fileName).toMatch(/^a-clip - 2-.+\.mp4$/u);
    expect(result.plan[0]!.fileName).not.toBe(result.plan[1]!.fileName);
  });

  it('renders the clip tokens from the export record and drops an empty optional group', () => {
    const result = planCutRename({
      ...baseParams,
      rule: '{source}[ - {label}]-{cut_from}',
      clips: [
        clip('a-1.mp4', { start: 5, end: 9, label: 'intro' }),
        clip('a-2.mp4', { start: 9, end: 12 }),
      ],
    });
    if ('problem' in result) throw new Error('expected a plan');

    expect(result.plan.map((entry) => entry.fileName)).toStrictEqual(['a - intro-00.00.05.000.mp4', 'a-00.00.09.000.mp4']);
  });

  it('keeps each result\'s own extension', () => {
    const result = planCutRename({ ...baseParams, rule: '{source}-clip', clips: [clip('a-1.mp4'), clip('a-2.mkv')] });
    if ('problem' in result) throw new Error('expected a plan');

    expect(result.plan[0]!.fileName.endsWith('.mp4')).toBe(true);
    expect(result.plan[1]!.fileName.endsWith('.mkv')).toBe(true);
    // Both names stay unique (they would collide otherwise) - checked on the stem, extension aside.
    expect(result.plan[0]!.fileName.replace(/\.mp4$/u, '')).not.toBe(result.plan[1]!.fileName.replace(/\.mkv$/u, ''));
  });

  it('refuses a rule with a folder separator instead of moving the result to another folder', () => {
    expect(planCutRename({ ...baseParams, rule: 'a/b-{seg_num}', clips: [clip('a-1.mp4')] })).toStrictEqual({
      problem: { code: 'separator', chars: '/' },
    });
  });

  it('refuses a name that does not fit the target folder', () => {
    const result = planCutRename({
      ...baseParams,
      rule: `${'x'.repeat(300)}-num`,
      clips: [clip('a-1.mp4')],
    });

    expect(result).toStrictEqual({ problem: { code: 'pathTooLong' } });
  });

  it('plans nothing for a job without results', () => {
    expect(planCutRename({ ...baseParams, rule: '{source}-clip', clips: [] })).toStrictEqual({ plan: [] });
  });
});

describe('resolveCutRenameFileName', () => {
  const plan = [
    { from: `${clipsDir}/a-1.mp4`, fileName: 'a-clip-1.mp4' },
    { from: `${clipsDir}/a-2.mp4`, fileName: '../escape.mp4' },
  ];

  it('uses a planned name for a result of this work area', () => {
    expect(resolveCutRenameFileName({ plan, clipPath: `${clipsDir}/a-1.mp4`, clipsDir, caseInsensitive: true })).toBe('a-clip-1.mp4');
  });

  it('keeps the original name when the planned one could leave the folder', () => {
    expect(resolveCutRenameFileName({ plan, clipPath: `${clipsDir}/a-2.mp4`, clipsDir, caseInsensitive: true })).toBeUndefined();
  });

  it('ignores a plan entry for a clip outside the work area', () => {
    const outside = 'C:/elsewhere/b-1.mp4';
    expect(resolveCutRenameFileName({
      plan: [{ from: outside, fileName: 'b-clip-1.mp4' }],
      clipPath: outside,
      clipsDir,
      caseInsensitive: true,
    })).toBeUndefined();
  });

  it('matches a path the way the file system does', () => {
    expect(resolveCutRenameFileName({
      plan: [{ from: `${clipsDir}/A-1.MP4`, fileName: 'a-clip-1.mp4' }],
      clipPath: `${clipsDir}/a-1.mp4`,
      clipsDir,
      caseInsensitive: true,
    })).toBe('a-clip-1.mp4');
    expect(resolveCutRenameFileName({
      plan: [{ from: `${clipsDir}/A-1.MP4`, fileName: 'a-clip-1.mp4' }],
      clipPath: `${clipsDir}/a-1.mp4`,
      clipsDir,
      caseInsensitive: false,
    })).toBeUndefined();
  });

  it('does nothing without a plan', () => {
    expect(resolveCutRenameFileName({ plan: undefined, clipPath: `${clipsDir}/a-1.mp4`, clipsDir, caseInsensitive: true })).toBeUndefined();
  });
});

describe('the stored rename choice', () => {
  it('is on by default, including for options stored before it existed', () => {
    expect(defaultPatchFinishCutOptions.cutRename).toStrictEqual({ enabled: true, rule: '{source}-clip-{seg_num}', labelSeparator: '-' });
    expect(parsePatchFinishCutOptions({ source: 'keep' }).cutRename.enabled).toBe(true);
    expect(parsePatchFinishCutOptions(undefined).cutRename).toStrictEqual(defaultPatchFinishCutOptions.cutRename);
  });

  it('keeps a stored rule and repairs malformed values', () => {
    expect(parsePatchFinishCutOptions({ cutRename: { enabled: false, rule: '{source}-final', labelSeparator: '#' } }).cutRename)
      .toStrictEqual({ enabled: false, rule: '{source}-final', labelSeparator: '#' });
    expect(parsePatchFinishCutOptions({ cutRename: { enabled: 'yes', rule: '  ', labelSeparator: 'nope' } }).cutRename)
      .toStrictEqual(defaultPatchFinishCutOptions.cutRename);
  });
});

describe('the rename blocks a cut job whose rule cannot render', () => {
  const previewFor = (): PatchFinishPreview => ({
    mode: 'cut',
    source: { path: 'C:/src/a.mp4', size: 100, exists: true, unreadable: false, insideWorkArea: false, dir: 'C:/src' },
    projectFile: undefined,
    merged: undefined,
    mergedInsideWorkArea: false,
    clips: [{ path: `${clipsDir}/a-1.mp4`, size: 10, mtimeMs: 100, start: 0, end: 1 }],
    clipsTotalSize: 10,
    outsideClipCount: 0,
    missingClipCount: 0,
    missingSelectedClipCount: 0,
    filesInUse: [],
    mergedCoversClips: false,
    hasRecord: true,
    dirs: {
      workDir: 'C:/work/.losslesscut_work',
      clipsDir,
      mergedDir: 'C:/work/.losslesscut_work/merged',
      finishedSrcMediaDir: 'C:/work/losslesscut_finished/finished_src_media',
      finishedSkipSrcMediaDir: 'C:/work/losslesscut_finished/finished_skip_src',
      detachedSrcMediaDir: 'C:/work/.losslesscut_work/detached_src_media',
      finishedMergedDir: 'C:/work/losslesscut_finished/finished_merged',
      finishedClipsDir,
      detachedClipsDir: 'C:/work/.losslesscut_work/detached_clips',
      detachedMergedDir: 'C:/work/.losslesscut_work/detached_merged',
      finishLlcDir: 'C:/work/losslesscut_finished/finish_llc',
    },
    workDirEntries: [],
    workDirScanFailed: false,
    projectStores: { userDataLlcDir: 'C:/u/llc', installLlcDir: 'C:/install/llc', installLlcWritable: true },
    warnings: [],
  });

  const cut = (overrides: Partial<PatchFinishCutOptions> = {}): PatchFinishCutOptions => ({
    ...defaultPatchFinishCutOptions,
    source: 'keep',
    projectFile: 'keep',
    ...overrides,
  });

  it('adds the problem while the rename is on', () => {
    const problems = getFinishOptionProblems({
      mode: 'cut',
      options: cut(),
      preview: previewFor(),
      cutRenameBlocked: true,
    });
    expect(problems).toStrictEqual(['cut-rename-invalid']);
  });

  it('does not block when the rename is off', () => {
    expect(getFinishOptionProblems({
      mode: 'cut',
      options: cut({ cutRename: { ...defaultPatchFinishCutOptions.cutRename, enabled: false } }),
      preview: previewFor(),
      cutRenameBlocked: false,
    })).toStrictEqual([]);
  });

  it('is a cut-only problem', () => {
    const problems = getFinishOptionProblems({
      mode: 'merge',
      options: defaultPatchFinishMergeOptions,
      preview: { ...previewFor(), mode: 'merge', mergedCoversClips: true, merged: { path: 'C:/work/.losslesscut_work/merged/m.mp4', size: 10, mtimeMs: 300 } },
      cutRenameBlocked: true,
    });
    expect(problems).not.toContain('cut-rename-invalid');
  });
});
