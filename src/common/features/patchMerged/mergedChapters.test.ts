// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { buildMergedChapters, buildMergedChapterNumbers, parsePatchMergedChapters, planMergedChapterSync } from './mergedChapters.js';

describe('buildMergedChapters', () => {
  it('lays chapters end to end in merge order', () => {
    expect(buildMergedChapters([
      { segId: 'a', label: 'one', segColorIndex: 2, duration: 10, fallbackDuration: 8 },
      { segId: 'b', label: 'two', segColorIndex: 5, duration: 4, fallbackDuration: 4 },
    ])).toStrictEqual([
      { segId: 'a', start: 0, end: 10, name: 'one', segColorIndex: 2 },
      { segId: 'b', start: 10, end: 14, name: 'two', segColorIndex: 5 },
    ]);
  });

  it('falls back to the source times when the probed duration is missing', () => {
    expect(buildMergedChapters([
      { segId: 'a', duration: undefined, fallbackDuration: 8 },
      { segId: 'b', duration: NaN, fallbackDuration: 4 },
    ])).toStrictEqual([
      { segId: 'a', start: 0, end: 8, name: '', segColorIndex: 0 },
      { segId: 'b', start: 8, end: 12, name: '', segColorIndex: 1 },
    ]);
  });

  it('skips a chapter with no usable duration', () => {
    expect(buildMergedChapters([
      { segId: 'a', duration: 0, fallbackDuration: -1 },
      { segId: 'b', duration: 4, fallbackDuration: 4 },
    ])).toStrictEqual([
      { segId: 'b', start: 0, end: 4, name: '', segColorIndex: 1 },
    ]);
  });

  it('returns no chapters for no sources', () => {
    expect(buildMergedChapters([])).toStrictEqual([]);
  });

  it('carries the cut-queue numbers of each chapter', () => {
    expect(buildMergedChapters([
      { segId: 'a', duration: 5, fallbackDuration: 5, startRank: 2, queueRank: 1 },
      { segId: 'b', duration: 5, fallbackDuration: 5, startRank: 1, queueRank: 2 },
    ])).toStrictEqual([
      { segId: 'a', start: 0, end: 5, name: '', segColorIndex: 0, startRank: 2, queueRank: 1 },
      { segId: 'b', start: 5, end: 10, name: '', segColorIndex: 1, startRank: 1, queueRank: 2 },
    ]);
  });
});

describe('buildMergedChapterNumbers', () => {
  it('reads the carried numbers', () => {
    expect([...buildMergedChapterNumbers([
      { segId: 'a', start: 0, end: 5, name: '', segColorIndex: 0, startRank: 2, queueRank: 1 },
    ])]).toStrictEqual([['a', { startRank: 2, queueRank: 1 }]]);
  });

  it('falls back to the merge position for old chapters', () => {
    expect([...buildMergedChapterNumbers([
      { segId: 'a', start: 0, end: 5, name: '', segColorIndex: 0 },
      { segId: 'b', start: 5, end: 9, name: '', segColorIndex: 1 },
    ])]).toStrictEqual([
      ['a', { startRank: 1, queueRank: 1 }],
      ['b', { startRank: 2, queueRank: 2 }],
    ]);
  });
});

describe('parsePatchMergedChapters', () => {
  it('keeps only valid chapters', () => {
    expect(parsePatchMergedChapters([
      { segId: 'a', start: 0, end: 10, name: 'one', segColorIndex: 2 },
      { segId: '', start: 0, end: 1, segColorIndex: 0 },
      { segId: 'b', start: 5, end: 5, segColorIndex: 0 },
      null,
    ])).toStrictEqual([
      { segId: 'a', start: 0, end: 10, name: 'one', segColorIndex: 2 },
    ]);
  });

  it('returns no chapters for anything that is not an array', () => {
    expect(parsePatchMergedChapters(undefined)).toStrictEqual([]);
  });
});

describe('planMergedChapterSync', () => {
  const chapter = { segId: 'a', start: 0, end: 10, name: 'one', segColorIndex: 2, startRank: 1, queueRank: 1 };

  it('loads the chapters in order, without the numbers', () => {
    expect(planMergedChapterSync([chapter, { ...chapter, segId: 'b', start: 10, end: 14, name: 'two' }])).toStrictEqual({
      kind: 'load',
      segments: [
        { segId: 'a', start: 0, end: 10, name: 'one', segColorIndex: 2 },
        { segId: 'b', start: 10, end: 14, name: 'two', segColorIndex: 2 },
      ],
    });
  });

  it('clears when there are no chapters (an older merged file, or another video)', () => {
    // The upstream loader throws on an empty list; the merged window must clear instead.
    expect(planMergedChapterSync([])).toStrictEqual({ kind: 'clear' });
    expect(planMergedChapterSync(undefined)).toStrictEqual({ kind: 'clear' });
  });
});
