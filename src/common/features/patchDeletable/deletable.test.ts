// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchOverviewSource } from '../patchResultsOverview/groupResults.js';

import {
  getPatchDetachableSourceReason,
  isPatchDetachSourceDeletable,
  isPatchDetachableSource,
  parsePatchDetachAllIncludesExtra,
  parsePatchDetachExtraDeletableReasons,
} from './deletable.js';

const result = (path: string) => ({ path, folder: 'finishedClips' as const });

function source(overrides: Partial<PatchOverviewSource> = {}): PatchOverviewSource {
  return {
    path: 'C:/work/.losslesscut_work/detached_src_media/a.mp4',
    folder: 'detachedSrc',
    clips: [],
    merged: [],
    parkedClips: [],
    parkedMerged: [],
    missing: [],
    pairing: 'none',
    ...overrides,
  };
}

describe('getPatchDetachableSourceReason', () => {
  it('offers a detached source with a kept cut result', () => {
    expect(getPatchDetachableSourceReason(source({ clips: [result('a-1.mp4')] }))).toBe('deletable');
  });

  it('offers a detached source with only a kept merged result', () => {
    expect(getPatchDetachableSourceReason(source({
      merged: [{ path: 'a-merge.mp4', folder: 'finishedMerged' }],
    }))).toBe('deletable');
  });

  it('refuses a source whose only results are parked for deletion', () => {
    expect(getPatchDetachableSourceReason(source({
      parkedClips: [{ path: 'a-1.mp4', folder: 'detachedClips' }],
    }))).toBe('parked-only');
  });

  it('refuses a source whose recorded results are gone from disk', () => {
    expect(getPatchDetachableSourceReason(source({ missing: ['a-1.mp4'] }))).toBe('results-missing');
  });

  it('refuses a detached source without any result', () => {
    expect(getPatchDetachableSourceReason(source())).toBe('no-results');
  });

  it('refuses sources outside the waiting-for-deletion folder', () => {
    expect(getPatchDetachableSourceReason(source({ folder: 'finishedSrc', clips: [result('a-1.mp4')] }))).toBe('not-detached');
    expect(getPatchDetachableSourceReason(source({ folder: 'finishedSkip', clips: [result('a-1.mp4')] }))).toBe('not-detached');
    expect(getPatchDetachableSourceReason(source({ folder: 'missing' }))).toBe('not-detached');
  });

  it('keeps a kept result ahead of a parked one', () => {
    expect(getPatchDetachableSourceReason(source({
      clips: [result('a-1.mp4')],
      parkedMerged: [{ path: 'a-merge.mp4', folder: 'detachedMerged' }],
    }))).toBe('deletable');
  });
});

describe('isPatchDetachableSource', () => {
  it('is true only for the deletable reason', () => {
    expect(isPatchDetachableSource(source({ clips: [result('a-1.mp4')] }))).toBe(true);
    expect(isPatchDetachableSource(source())).toBe(false);
    expect(isPatchDetachableSource(source({ folder: 'finishedSrc', clips: [result('a-1.mp4')] }))).toBe(false);
  });
});

describe('isPatchDetachSourceDeletable', () => {
  it('keeps the strict rule when no extra reason is allowed', () => {
    expect(isPatchDetachSourceDeletable(source({ clips: [result('a-1.mp4')] }))).toBe(true);
    expect(isPatchDetachSourceDeletable(source())).toBe(false);
    expect(isPatchDetachSourceDeletable(source({ missing: ['a-1.mp4'] }))).toBe(false);
    expect(isPatchDetachSourceDeletable(source({
      parkedClips: [{ path: 'a-1.mp4', folder: 'detachedClips' }],
    }))).toBe(false);
  });

  it('opens only the reasons the user allowed', () => {
    expect(isPatchDetachSourceDeletable(source(), ['no-results'])).toBe(true);
    expect(isPatchDetachSourceDeletable(source(), ['results-missing'])).toBe(false);
    expect(isPatchDetachSourceDeletable(source({ missing: ['a-1.mp4'] }), ['results-missing'])).toBe(true);
    expect(isPatchDetachSourceDeletable(source({
      parkedClips: [{ path: 'a-1.mp4', folder: 'detachedClips' }],
    }), ['parked-only'])).toBe(true);
  });

  it('never opens a source of another folder, whatever is allowed', () => {
    expect(isPatchDetachSourceDeletable(
      source({ folder: 'finishedSrc' }),
      ['no-results', 'results-missing', 'parked-only'],
    )).toBe(false);
  });
});

describe('parsePatchDetachExtraDeletableReasons', () => {
  it('defaults to nothing', () => {
    expect(parsePatchDetachExtraDeletableReasons(undefined)).toStrictEqual([]);
    expect(parsePatchDetachExtraDeletableReasons(null)).toStrictEqual([]);
    expect(parsePatchDetachExtraDeletableReasons('no-results')).toStrictEqual([]);
    expect(parsePatchDetachExtraDeletableReasons([])).toStrictEqual([]);
  });

  it('drops unknown entries, collapses duplicates and keeps the dialog order', () => {
    expect(parsePatchDetachExtraDeletableReasons([
      'parked-only',
      'bogus',
      'no-results',
      'parked-only',
      'deletable',
      'not-detached',
      7,
    ])).toStrictEqual(['no-results', 'parked-only']);
  });
});

describe('parsePatchDetachAllIncludesExtra', () => {
  it('is false unless the stored value is exactly true', () => {
    expect(parsePatchDetachAllIncludesExtra(undefined)).toBe(false);
    expect(parsePatchDetachAllIncludesExtra(false)).toBe(false);
    expect(parsePatchDetachAllIncludesExtra('true')).toBe(false);
    expect(parsePatchDetachAllIncludesExtra(1)).toBe(false);
    expect(parsePatchDetachAllIncludesExtra(true)).toBe(true);
  });
});
