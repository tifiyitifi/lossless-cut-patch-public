// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { applyChapterNumbers, buildOtherVideoPaths, buildResumeClipEntries, buildResumeMergedChapters, decideResumeAvailability } from './resumeScan.js';

describe('buildResumeClipEntries', () => {
  it('orders by start and attaches the source', () => {
    expect(buildResumeClipEntries({
      b: { start: 10, end: 12, path: '/clips/b.mp4', label: 'B' },
      a: { start: 2, end: 4, path: '/clips/a.mp4' },
    }, '/src/a.mp4')).toStrictEqual([
      { path: '/clips/a.mp4', segId: 'a', sourcePath: '/src/a.mp4' },
      { path: '/clips/b.mp4', label: 'B', segId: 'b', sourcePath: '/src/a.mp4' },
    ]);
  });

  it('follows the recorded cut-queue order when the manifest has one', () => {
    // The clips window must show the order the results were merged in, not the timeline order.
    expect(buildResumeClipEntries({
      a: { start: 2, end: 4, path: '/clips/a.mp4' },
      b: { start: 10, end: 12, path: '/clips/b.mp4', label: 'B' },
    }, '/src/a.mp4', ['b', 'a'])).toStrictEqual([
      { path: '/clips/b.mp4', label: 'B', segId: 'b', sourcePath: '/src/a.mp4' },
      { path: '/clips/a.mp4', segId: 'a', sourcePath: '/src/a.mp4' },
    ]);
  });

  it('leaves out a result the order does not list', () => {
    expect(buildResumeClipEntries({
      a: { start: 2, end: 4, path: '/clips/a.mp4' },
      b: { start: 10, end: 12, path: '/clips/b.mp4' },
    }, '/src/a.mp4', ['b']).map((entry) => entry.segId)).toStrictEqual(['b']);
  });
});

describe('decideResumeAvailability', () => {
  it('is empty without clips and without merged', () => {
    expect(decideResumeAvailability({ clipCount: 0, mergedExists: false })).toBeUndefined();
  });

  it('reports clips-only and both', () => {
    expect(decideResumeAvailability({ clipCount: 2, mergedExists: false })).toStrictEqual({ hasClips: true, hasMerged: false });
    expect(decideResumeAvailability({ clipCount: 0, mergedExists: true })).toStrictEqual({ hasClips: false, hasMerged: true });
  });
});

describe('applyChapterNumbers', () => {
  const chapter = (segId: string, extra = {}) => ({ segId, start: 0, end: 5, name: '', segColorIndex: 0, ...extra });

  it('fills in the numbers of a merged file recorded without them', () => {
    expect(applyChapterNumbers([chapter('a'), chapter('b')], new Map([
      ['a', { startRank: 2, queueRank: 1 }],
      ['b', { startRank: 1, queueRank: 2 }],
    ]))).toStrictEqual([
      chapter('a', { startRank: 2, queueRank: 1 }),
      chapter('b', { startRank: 1, queueRank: 2 }),
    ]);
  });

  it('overwrites stale numbers with the recomputed ones', () => {
    expect(applyChapterNumbers([chapter('a', { startRank: 9, queueRank: 9 })], new Map([
      ['a', { startRank: 1, queueRank: 1 }],
    ]))).toStrictEqual([chapter('a', { startRank: 1, queueRank: 1 })]);
  });

  it('leaves a chapter the manifest does not know untouched', () => {
    const unknown = chapter('gone', { startRank: 3, queueRank: 4 });
    expect(applyChapterNumbers([unknown], new Map())).toStrictEqual([unknown]);
  });

  it('keeps the carried numbers when a segment is not exported', () => {
    expect(applyChapterNumbers([chapter('a', { startRank: 1 })], new Map([
      ['a', { startRank: 1 }],
    ]))).toStrictEqual([chapter('a', { startRank: 1 })]);
  });

  it('drops a queue position the current queue no longer has', () => {
    expect(applyChapterNumbers([chapter('a', { startRank: 1, queueRank: 9 })], new Map([
      ['a', { startRank: 2 }],
    ]))).toStrictEqual([chapter('a', { startRank: 2 })]);
  });
});

describe('buildResumeMergedChapters', () => {
  const clip = (segId: string, start: number, end: number, extra = {}) => ({ segId, start, end, path: `/clips/${segId}.mp4`, ...extra });

  it('keeps the stored chapters and refreshes their numbers', () => {
    expect(buildResumeMergedChapters({
      storedChapters: [{ segId: 'a', start: 0, end: 5, name: 'one', segColorIndex: 3 }],
      clips: [],
      numbers: new Map([['a', { startRank: 2, queueRank: 1 }]]),
    })).toStrictEqual([{ segId: 'a', start: 0, end: 5, name: 'one', segColorIndex: 3, startRank: 2, queueRank: 1 }]);
  });

  it('rebuilds the chapters of a merged file recorded without them', () => {
    // An older merged-only record: the clips are gone, the segment records still describe the merge.
    // The clips arrive in merge order (the manifest's start order), so the chapters keep it.
    expect(buildResumeMergedChapters({
      storedChapters: undefined,
      clips: [clip('a', 2, 5, { segColorIndex: 4 }), clip('b', 10, 13, { label: 'B', segColorIndex: 7 })],
      numbers: new Map([['a', { startRank: 1, queueRank: 2 }], ['b', { startRank: 2, queueRank: 1 }]]),
    })).toStrictEqual([
      { segId: 'a', start: 0, end: 3, name: '', segColorIndex: 4, startRank: 1, queueRank: 2 },
      { segId: 'b', start: 3, end: 6, name: 'B', segColorIndex: 7, startRank: 2, queueRank: 1 },
    ]);
  });

  it('has nothing to show when the manifest knows no segments', () => {
    expect(buildResumeMergedChapters({ storedChapters: undefined, clips: [], numbers: new Map() })).toStrictEqual([]);
  });
});

describe('buildOtherVideoPaths', () => {
  it('excludes the playlist by file-system semantics and keeps order', () => {
    expect(buildOtherVideoPaths({
      allPaths: [String.raw`C:\work\clips\a.mp4`, 'C:/work/clips/b.mp4', 'C:/work/clips/c.mp4'],
      excludePaths: [String.raw`c:\work/clips/B.mp4`],
      caseInsensitive: true,
    })).toStrictEqual([String.raw`C:\work\clips\a.mp4`, 'C:/work/clips/c.mp4']);
  });
});
