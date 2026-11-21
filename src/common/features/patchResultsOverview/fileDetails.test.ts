// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { collectOverviewFilePaths } from './fileDetails.js';
import type { PatchOverview, PatchOverviewSource } from './groupResults.js';

const dirs = {
  detachedSrcMediaDir: undefined,
  finishedSrcMediaDir: undefined,
  finishedSkipSrcMediaDir: undefined,
  finishedClipsDir: undefined,
  finishedMergedDir: undefined,
  detachedClipsDir: undefined,
  detachedMergedDir: undefined,
};

function source(path: string, overrides: Partial<PatchOverviewSource> = {}): PatchOverviewSource {
  return {
    path,
    folder: 'finishedSrc',
    clips: [],
    merged: [],
    parkedClips: [],
    parkedMerged: [],
    missing: [],
    pairing: 'none',
    ...overrides,
  };
}

function overview(sources: PatchOverviewSource[], overrides: Partial<PatchOverview> = {}): PatchOverview {
  return {
    workRoot: String.raw`C:\work`,
    dirs,
    sources,
    unowned: [],
    stats: { sources: sources.length, clips: 0, merged: 0, isolated: 0, clipsOnly: 0, mergedOnly: 0, parkedOnly: 0, complete: 0, sourceGone: 0, unowned: 0, missing: 0 },
    openTargets: { detachedSources: false, finishedSources: false, finishedSkipSources: false, finishedClips: false, finishedMerged: false },
    warnings: [],
    ...overrides,
  };
}

describe('collectOverviewFilePaths', () => {
  it('returns the source first, then every result it has, in folder order', () => {
    const paths = collectOverviewFilePaths(overview([source(String.raw`C:\work\a.mp4`, {
      clips: [
        { path: String.raw`C:\work\a-1.mp4`, folder: 'finishedClips' },
        { path: String.raw`C:\work\a-2.mp4`, folder: 'detachedClips' },
      ],
      merged: [{ path: String.raw`C:\work\a-merge.mkv`, folder: 'finishedMerged' }],
      parkedClips: [{ path: String.raw`C:\work\a-3.mp4`, folder: 'detachedClips' }],
      parkedMerged: [{ path: String.raw`C:\work\a-merge-old.mkv`, folder: 'detachedMerged' }],
    })]));

    expect(paths).toStrictEqual([
      String.raw`C:\work\a.mp4`,
      String.raw`C:\work\a-1.mp4`,
      String.raw`C:\work\a-2.mp4`,
      String.raw`C:\work\a-merge.mkv`,
      String.raw`C:\work\a-3.mp4`,
      String.raw`C:\work\a-merge-old.mkv`,
    ]);
  });

  it('skips a source the disk lost, but keeps the results that still exist', () => {
    const paths = collectOverviewFilePaths(overview([source(String.raw`C:\work\gone.mp4`, {
      folder: 'missing',
      clips: [{ path: String.raw`C:\work\gone-1.mp4`, folder: 'finishedClips' }],
    })]));

    expect(paths).toStrictEqual([String.raw`C:\work\gone-1.mp4`]);
  });

  it('does not ask for result paths the ledger recorded but the disk does not have', () => {
    const paths = collectOverviewFilePaths(overview([source(String.raw`C:\work\a.mp4`, {
      clips: [{ path: String.raw`C:\work\a-1.mp4`, folder: 'finishedClips' }],
      missing: [String.raw`C:\work\a-2.mp4`],
    })]));

    expect(paths).toStrictEqual([String.raw`C:\work\a.mp4`, String.raw`C:\work\a-1.mp4`]);
  });

  it('adds unclaimed results and skips a path that is listed twice', () => {
    const paths = collectOverviewFilePaths(overview(
      [source(String.raw`C:\work\a.mp4`, { clips: [{ path: String.raw`C:\work\a-1.mp4`, folder: 'finishedClips' }] })],
      { unowned: [{ path: String.raw`C:\work\a-1.mp4`, folder: 'finishedClips' }, { path: String.raw`C:\work\loose.mp4`, folder: 'detachedClips' }] },
    ));

    expect(paths).toStrictEqual([String.raw`C:\work\a.mp4`, String.raw`C:\work\a-1.mp4`, String.raw`C:\work\loose.mp4`]);
  });

  it('returns nothing for a work folder without files', () => {
    expect(collectOverviewFilePaths(overview([]))).toStrictEqual([]);
  });
});
