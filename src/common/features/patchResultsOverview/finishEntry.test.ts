// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { buildFinishLedgerEntry } from './finishEntry.js';

const dirs = {
  finishedClipsDir: '/w/finished/finished_clips',
  finishedMergedDir: '/w/finished/finished_merged',
  detachedClipsDir: '/w/detached_clips',
  detachedMergedDir: '/w/detached_merged',
};

const ci = { caseInsensitive: true };

describe('buildFinishLedgerEntry', () => {
  it('records what a merged job kept', () => {
    const entry = buildFinishLedgerEntry({
      sourcePath: '/w/a.mp4',
      newSourcePath: '/w/finished/finished_src_media/a.mp4',
      clipPaths: ['/w/clips/a-1.mp4', '/w/clips/a-2.mp4'],
      mergedPath: '/w/merged/a-merge.mp4',
      moved: [
        { from: '/w/a.mp4', to: '/w/finished/finished_src_media/a.mp4' },
        { from: '/w/clips/a-1.mp4', to: '/w/finished/finished_clips/a-1.mp4' },
        { from: '/w/clips/a-2.mp4', to: '/w/finished/finished_clips/a-2.mp4' },
        { from: '/w/merged/a-merge.mp4', to: '/w/finished/finished_merged/a-merge.mp4' },
      ],
      dirs,
      at: 7,
    }, ci);

    expect(entry).toStrictEqual({
      source: '/w/finished/finished_src_media/a.mp4',
      clips: ['/w/finished/finished_clips/a-1.mp4', '/w/finished/finished_clips/a-2.mp4'],
      merged: ['/w/finished/finished_merged/a-merge.mp4'],
      parkedClips: [],
      parkedMerged: [],
      at: 7,
    });
  });

  it('records the source fingerprint the caller read', () => {
    const entry = buildFinishLedgerEntry({
      sourcePath: '/w/a.mp4',
      newSourcePath: '/w/detached_src_media/a.mp4',
      sourceIdentity: { size: 10, hash: 'h' },
      clipPaths: ['/w/clips/a-1.mp4'],
      mergedPath: undefined,
      moved: [
        { from: '/w/a.mp4', to: '/w/detached_src_media/a.mp4' },
        { from: '/w/clips/a-1.mp4', to: '/w/finished/finished_clips/a-1.mp4' },
      ],
      dirs,
      at: 1,
    }, ci);

    expect(entry?.sourceIdentity).toStrictEqual({ size: 10, hash: 'h' });
  });

  it('records parked results of a discarded source', () => {
    const entry = buildFinishLedgerEntry({
      sourcePath: '/w/a.mp4',
      newSourcePath: '/w/detached_src_media/a.mp4',
      clipPaths: ['/w/clips/a-1.mp4'],
      mergedPath: '/w/merged/a-merge.mp4',
      moved: [
        { from: '/w/a.mp4', to: '/w/detached_src_media/a.mp4' },
        { from: '/w/clips/a-1.mp4', to: '/w/detached_clips/a-1.mp4' },
        { from: '/w/merged/a-merge.mp4', to: '/w/detached_merged/a-merge.mp4' },
      ],
      dirs,
      at: 1,
    }, ci);

    expect(entry?.parkedClips).toStrictEqual(['/w/detached_clips/a-1.mp4']);
    expect(entry?.parkedMerged).toStrictEqual(['/w/detached_merged/a-merge.mp4']);
    expect(entry?.clips).toStrictEqual([]);
    expect(entry?.merged).toStrictEqual([]);
  });

  it('leaves out a cut result the job deleted', () => {
    const entry = buildFinishLedgerEntry({
      sourcePath: '/w/a.mp4',
      newSourcePath: undefined,
      clipPaths: ['/w/clips/a-1.mp4'],
      mergedPath: undefined,
      moved: [],
      dirs,
      at: 1,
    }, ci);

    expect(entry).toBeUndefined();
  });

  it('keeps a merged result that was already at its target', () => {
    const entry = buildFinishLedgerEntry({
      sourcePath: '/w/a.mp4',
      newSourcePath: undefined,
      clipPaths: [],
      mergedPath: '/w/finished/finished_merged/a-merge.mp4',
      moved: [],
      dirs,
      at: 1,
    }, ci);

    expect(entry?.merged).toStrictEqual(['/w/finished/finished_merged/a-merge.mp4']);
  });

  it('records a source that was deleted but kept its results', () => {
    const entry = buildFinishLedgerEntry({
      sourcePath: String.raw`C:\v\a.mp4`,
      newSourcePath: undefined,
      clipPaths: [String.raw`C:\v\work\clips\a-1.mp4`],
      mergedPath: undefined,
      moved: [{ from: String.raw`C:\v\work\clips\a-1.mp4`, to: String.raw`C:\v\finished\finished_clips\a-1.mp4` }],
      dirs: {
        finishedClipsDir: 'c:/v/finished/finished_clips',
        finishedMergedDir: 'c:/v/finished/finished_merged',
        detachedClipsDir: 'c:/v/work/detached_clips',
        detachedMergedDir: 'c:/v/work/detached_merged',
      },
      at: 1,
    }, ci);

    expect(entry?.source).toBe(String.raw`C:\v\a.mp4`);
    expect(entry?.clips).toStrictEqual([String.raw`C:\v\finished\finished_clips\a-1.mp4`]);
  });
});
