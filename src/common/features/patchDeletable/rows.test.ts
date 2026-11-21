// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchOverview, PatchOverviewSource } from '../patchResultsOverview/groupResults.js';

import { buildPatchDetachableReport } from './rows.js';

const detached = 'C:/work/.losslesscut_work/detached_src_media';

function source(overrides: Partial<PatchOverviewSource>): PatchOverviewSource {
  return {
    path: `${detached}/a.mp4`,
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

function overview(sources: PatchOverviewSource[]): PatchOverview {
  return {
    workRoot: 'C:/work',
    dirs: {
      detachedSrcMediaDir: detached,
      finishedSrcMediaDir: 'C:/work/losslesscut_finished/finished_src_media',
      finishedSkipSrcMediaDir: 'C:/work/losslesscut_finished/finished_skip_src',
      finishedClipsDir: 'C:/work/losslesscut_finished/finished_clips',
      finishedMergedDir: 'C:/work/losslesscut_finished/finished_merged',
      detachedClipsDir: 'C:/work/.losslesscut_work/detached_clips',
      detachedMergedDir: 'C:/work/.losslesscut_work/detached_merged',
    },
    sources,
    unowned: [],
    stats: { sources: sources.length, clips: 0, merged: 0, isolated: 0, clipsOnly: 0, mergedOnly: 0, parkedOnly: 0, complete: 0, sourceGone: 0, unowned: 0, missing: 0 },
    openTargets: { detachedSources: true, finishedSources: false, finishedSkipSources: false, finishedClips: false, finishedMerged: false },
    warnings: [],
  };
}

describe('buildPatchDetachableReport', () => {
  it('keeps the detached sources and carries their reason', () => {
    const report = buildPatchDetachableReport(overview([
      source({ path: `${detached}/b.mp4`, clips: [{ path: 'b-1.mp4', folder: 'finishedClips' }] }),
      source({ path: `${detached}/a.mp4` }),
      source({ path: `${detached}/c.mp4`, missing: ['c-1.mp4'], pairing: 'ledger' }),
    ]));

    expect(report.rows.map((row) => [row.path, row.reason])).toStrictEqual([
      [`${detached}/a.mp4`, 'no-results'],
      [`${detached}/b.mp4`, 'deletable'],
      [`${detached}/c.mp4`, 'results-missing'],
    ]);
    expect(report.totals).toStrictEqual({ sources: 3, deletable: 1, results: 1 });
    expect(report.detachedSrcMediaDir).toBe(detached);
  });

  it('leaves out the sources of the finished folders', () => {
    const report = buildPatchDetachableReport(overview([
      source({ path: 'C:/work/losslesscut_finished/finished_src_media/kept.mp4', folder: 'finishedSrc', clips: [{ path: 'kept-1.mp4', folder: 'finishedClips' }] }),
      source({ path: 'C:/work/losslesscut_finished/finished_skip_src/skipped.mp4', folder: 'finishedSkip' }),
    ]));

    expect(report.rows).toStrictEqual([]);
    expect(report.totals).toStrictEqual({ sources: 0, deletable: 0, results: 0 });
  });

  it('counts parked and missing results without offering them for deletion', () => {
    const report = buildPatchDetachableReport(overview([
      source({ parkedClips: [{ path: 'a-1.mp4', folder: 'detachedClips' }] }),
    ]));

    expect(report.rows[0]?.reason).toBe('parked-only');
    expect(report.rows[0]?.deletable).toBe(false);
    expect(report.rows[0]?.parked).toHaveLength(1);
    expect(report.totals.results).toBe(0);
  });

  it('passes the warnings through', () => {
    const base = overview([]);
    const report = buildPatchDetachableReport({ ...base, warnings: ['dir-unreadable'] });

    expect(report.warnings).toStrictEqual(['dir-unreadable']);
  });

  it('makes only the extra kinds the user allowed deletable', () => {
    const base = overview([
      source({ path: `${detached}/a.mp4` }),
      source({ path: `${detached}/b.mp4`, missing: ['b-1.mp4'], pairing: 'ledger' }),
      source({ path: `${detached}/c.mp4`, parkedClips: [{ path: 'c-1.mp4', folder: 'detachedClips' }] }),
    ]);

    // Nothing allowed: the same strict rule as before.
    const strict = buildPatchDetachableReport(base);
    expect(strict.rows.map((row) => row.deletable)).toStrictEqual([false, false, false]);
    expect(strict.totals.deletable).toBe(0);

    // One reason allowed: only that kind opens.
    const one = buildPatchDetachableReport(base, ['results-missing']);
    expect(one.rows.map((row) => [row.reason, row.deletable])).toStrictEqual([
      ['no-results', false],
      ['results-missing', true],
      ['parked-only', false],
    ]);
    expect(one.totals.deletable).toBe(1);

    // All allowed: every detached source may be deleted; the totals follow.
    const all = buildPatchDetachableReport(base, ['no-results', 'results-missing', 'parked-only']);
    expect(all.rows.map((row) => row.deletable)).toStrictEqual([true, true, true]);
    expect(all.totals.deletable).toBe(3);
  });
});
