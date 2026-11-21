// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { normalizeManifestPath } from '../patchExport/manifest.js';

import { buildOverviewGroups, getPatchOverviewSourceStatus, groupPatchResultsOverview, isResultNameOfSource } from './groupResults.js';

import type { PatchOverviewScan } from './groupResults.js';
import type { PatchFinishLedgerEntry } from './ledger.js';

const ci = { caseInsensitive: true };

const dirs = {
  detachedSrcMediaDir: '/w/detached_src_media',
  finishedSrcMediaDir: '/w/finished/finished_src_media',
  finishedSkipSrcMediaDir: '/w/finished/finished_skip_src',
  finishedClipsDir: '/w/finished/finished_clips',
  finishedMergedDir: '/w/finished/finished_merged',
  detachedClipsDir: '/w/detached_clips',
  detachedMergedDir: '/w/detached_merged',
};

function entry(overrides: Partial<PatchFinishLedgerEntry>): PatchFinishLedgerEntry {
  return { source: '/w/detached_src_media/a.mp4', clips: [], merged: [], parkedClips: [], parkedMerged: [], at: 1, ...overrides };
}

function scan(overrides: Partial<PatchOverviewScan> = {}): PatchOverviewScan {
  return {
    workRoot: '/w',
    dirs,
    sources: [],
    finishedClips: [],
    finishedMerged: [],
    detachedClips: [],
    detachedMerged: [],
    projectRecords: [],
    ledger: { version: 1, entries: [] },
    openTargets: { detachedSources: true, finishedSources: false, finishedSkipSources: false, finishedClips: true, finishedMerged: true },
    ...overrides,
  };
}

describe('isResultNameOfSource', () => {
  it('accepts the shapes the naming rules produce and nothing else', () => {
    expect(isResultNameOfSource('a-1-0_1-2_3', 'a', ci)).toBe(true);
    expect(isResultNameOfSource('a - label-merge', 'a', ci)).toBe(true);
    expect(isResultNameOfSource('a', 'a', ci)).toBe(true);
    expect(isResultNameOfSource('ab-1', 'a', ci)).toBe(false);
    expect(isResultNameOfSource('A-1', 'a', ci)).toBe(true);
  });
});

describe('groupPatchResultsOverview', () => {
  it('lists sources without results first and counts them', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [
        { path: '/w/detached_src_media/c.mp4', folder: 'detachedSrc' },
        { path: '/w/detached_src_media/a.mp4', folder: 'detachedSrc' },
        { path: '/w/detached_src_media/b.mp4', folder: 'detachedSrc' },
      ],
      finishedClips: ['/w/finished/finished_clips/c-1.mp4'],
    }), ci);

    expect(overview.sources.map((source) => source.path)).toStrictEqual([
      '/w/detached_src_media/a.mp4',
      '/w/detached_src_media/b.mp4',
      '/w/detached_src_media/c.mp4',
    ]);
    expect(overview.stats).toMatchObject({ sources: 3, clips: 1, isolated: 2, clipsOnly: 1, complete: 0, unowned: 0 });
  });

  it('pairs with the ledger paths and follows parked results', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [{ path: '/w/detached_src_media/a.mp4', folder: 'detachedSrc' }],
      finishedClips: ['/w/finished/finished_clips/a-1.mp4'],
      detachedMerged: ['/w/detached_merged/a-merge.mp4'],
      ledger: {
        version: 1,
        entries: [entry({ clips: ['/w/finished/finished_clips/a-1.mp4'], parkedMerged: ['/w/detached_merged/a-merge.mp4'] })],
      },
    }), ci);

    const [source] = overview.sources;
    expect(source?.pairing).toBe('ledger');
    expect(source?.clips.map((clip) => clip.path)).toStrictEqual(['/w/finished/finished_clips/a-1.mp4']);
    expect(source?.parkedMerged.map((merged) => merged.path)).toStrictEqual(['/w/detached_merged/a-merge.mp4']);
    expect(getPatchOverviewSourceStatus(source!)).toBe('clipsOnly');
  });

  it('reports a result the ledger records but the disk does not have', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [{ path: '/w/detached_src_media/a.mp4', folder: 'detachedSrc' }],
      ledger: { version: 1, entries: [entry({ clips: ['/w/finished/finished_clips/a-1.mp4'] })] },
    }), ci);

    expect(overview.sources[0]?.missing).toStrictEqual(['/w/finished/finished_clips/a-1.mp4']);
    expect(overview.stats.missing).toBe(1);
    expect(getPatchOverviewSourceStatus(overview.sources[0]!)).toBe('none');
  });

  it('pairs with the outputs a project file records', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [{ path: '/w/detached_src_media/a.mp4', folder: 'detachedSrc' }],
      finishedMerged: ['/w/finished/finished_merged/a-merge.mp4'],
      projectRecords: [{ sourcePath: '/w/detached_src_media/a.mp4', clips: [], merged: ['a-merge.mp4'] }],
    }), ci);

    expect(overview.sources[0]?.merged).toHaveLength(1);
    expect(overview.sources[0]?.pairing).toBe('project');
  });

  it('does not hand a result to the wrong source when two project files name it', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [
        { path: '/w/detached_src_media/001.mp4', folder: 'detachedSrc' },
        { path: '/w/finished/finished_src_media/001.mp4', folder: 'finishedSrc' },
      ],
      finishedClips: ['/w/finished/finished_clips/001-001.mp4'],
      projectRecords: [
        { sourcePath: '/w/detached_src_media/001.mp4', clips: ['001-001.mp4'], merged: [] },
        { sourcePath: '/w/finished/finished_src_media/001.mp4', clips: ['001-001.mp4'], merged: [] },
      ],
    }), ci);

    // The result is in `finished_clips`, so it is the finished source's. The detached source must not
    // show it as its own: that is what let it count as "ready for deletion".
    const detached = overview.sources.find((source) => source.folder === 'detachedSrc');
    const finished = overview.sources.find((source) => source.folder === 'finishedSrc');
    expect(detached?.clips).toStrictEqual([]);
    expect(detached?.pairing).toBe('none');
    expect(finished?.clips.map((clip) => clip.path)).toStrictEqual(['/w/finished/finished_clips/001-001.mp4']);
  });

  it('keeps a detached result when a finished source records the same name', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [
        { path: '/w/detached_src_media/001.mp4', folder: 'detachedSrc' },
        { path: '/w/finished/finished_src_media/001.mp4', folder: 'finishedSrc' },
      ],
      finishedClips: ['/w/finished/finished_clips/clip-final.mp4'],
      detachedClips: ['/w/detached/detached_clips/clip-final.mp4'],
      projectRecords: [
        { sourcePath: '/w/detached_src_media/001.mp4', clips: ['clip-final.mp4'], merged: [] },
        { sourcePath: '/w/finished/finished_src_media/001.mp4', clips: ['clip-final.mp4'], merged: [] },
      ],
    }), ci);

    // Both folders hold the same name. The finished result belongs to the finished source and the
    // parked one to the detached source; neither may be left unowned, and the detached source must
    // not be stranded just because the finished copy is found first.
    const detached = overview.sources.find((source) => source.folder === 'detachedSrc');
    const finished = overview.sources.find((source) => source.folder === 'finishedSrc');
    expect(finished?.clips.map((clip) => clip.path)).toStrictEqual(['/w/finished/finished_clips/clip-final.mp4']);
    expect(detached?.parkedClips.map((clip) => clip.path)).toStrictEqual(['/w/detached/detached_clips/clip-final.mp4']);
    expect(detached?.pairing).toBe('project');
    expect(overview.unowned).toHaveLength(0);
  });

  it('leaves a name two sources of the same kind both list unowned', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [
        { path: '/w/finished/finished_src_media/001.mp4', folder: 'finishedSrc' },
        { path: '/w/finished/finished_skip_src/001.mp4', folder: 'finishedSkip' },
      ],
      finishedClips: ['/w/finished/finished_clips/001-001.mp4'],
      projectRecords: [
        { sourcePath: '/w/finished/finished_src_media/001.mp4', clips: ['001-001.mp4'], merged: [] },
        { sourcePath: '/w/finished/finished_skip_src/001.mp4', clips: ['001-001.mp4'], merged: [] },
      ],
    }), ci);

    // Both are "finished", so the folder cannot decide: guessing would make one of them look complete.
    expect(overview.sources.every((source) => source.clips.length === 0)).toBe(true);
    expect(overview.unowned.map((item) => item.path)).toStrictEqual(['/w/finished/finished_clips/001-001.mp4']);
  });

  it('falls back to the file name, preferring the longest source stem', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [
        { path: '/w/detached_src_media/a.mp4', folder: 'detachedSrc' },
        { path: '/w/detached_src_media/a-1.mp4', folder: 'detachedSrc' },
      ],
      finishedClips: ['/w/finished/finished_clips/a-1-0_1.mp4'],
    }), ci);

    const source = overview.sources.find((row) => row.path === '/w/detached_src_media/a-1.mp4');
    expect(source?.clips).toHaveLength(1);
    expect(source?.pairing).toBe('name');
  });

  it('prefers the source folder the result came from when two sources share the stem', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [
        { path: '/w/detached_src_media/a.mp4', folder: 'detachedSrc' },
        { path: '/w/finished/finished_src_media/a.mp4', folder: 'finishedSrc' },
      ],
      detachedClips: ['/w/detached_clips/a-1.mp4'],
    }), ci);

    // A detached result prefers the detached source, so it is paired rather than guessed.
    expect(overview.sources.find((row) => row.folder === 'detachedSrc')?.parkedClips).toHaveLength(1);
    expect(overview.unowned).toHaveLength(0);
  });

  it('counts a skipped source as finished when two sources share the stem', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [
        { path: '/w/detached_src_media/a.mp4', folder: 'detachedSrc' },
        { path: '/w/finished/finished_skip_src/a.mp4', folder: 'finishedSkip' },
      ],
      finishedClips: ['/w/finished/finished_clips/a-1.mp4'],
    }), ci);

    expect(overview.sources.find((row) => row.folder === 'finishedSkip')?.clips).toHaveLength(1);
    expect(overview.sources.find((row) => row.folder === 'detachedSrc')?.clips).toHaveLength(0);
    expect(overview.unowned).toHaveLength(0);
  });

  it('keeps skipped sources separate from the finished ones', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [
        { path: '/w/finished/finished_src_media/a.mp4', folder: 'finishedSrc' },
        { path: '/w/finished/finished_skip_src/b.mp4', folder: 'finishedSkip' },
      ],
    }), ci);

    expect(overview.sources.map((source) => source.folder).sort()).toStrictEqual(['finishedSkip', 'finishedSrc']);
    expect(overview.stats.sources).toBe(2);
    expect(overview.stats.isolated).toBe(2);
  });

  it('keeps results without any source as unowned', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [{ path: '/w/detached_src_media/a.mp4', folder: 'detachedSrc' }],
      finishedClips: ['/w/finished/finished_clips/zzz-1.mp4'],
    }), ci);

    expect(overview.unowned).toStrictEqual([{ path: '/w/finished/finished_clips/zzz-1.mp4', folder: 'finishedClips' }]);
    expect(overview.stats.unowned).toBe(1);
  });

  it('keeps the results of a source that is gone', () => {
    const overview = groupPatchResultsOverview(scan({
      finishedMerged: ['/w/finished/finished_merged/a-merge.mp4'],
      ledger: { version: 1, entries: [entry({ source: '/w/detached_src_media/a.mp4', merged: ['/w/finished/finished_merged/a-merge.mp4'] })] },
    }), ci);

    const [source] = overview.sources;
    expect(source?.folder).toBe('missing');
    expect(overview.stats.sourceGone).toBe(1);
    expect(overview.stats.sources).toBe(0);

    const group = buildOverviewGroups(overview).find((item) => item.id === 'sourceGone');
    expect(group?.sources).toHaveLength(1);
  });

  it('never takes a file another tier already claimed', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [
        { path: '/w/detached_src_media/a.mp4', folder: 'detachedSrc' },
        { path: '/w/detached_src_media/b.mp4', folder: 'detachedSrc' },
      ],
      finishedClips: ['/w/finished/finished_clips/b-1.mp4'],
      ledger: {
        version: 1,
        entries: [
          entry({ source: '/w/detached_src_media/a.mp4', clips: ['/w/finished/finished_clips/b-1.mp4'] }),
        ],
      },
    }), ci);

    // The ledger says the file belongs to `a`; the name would have said `b`.
    expect(overview.sources.find((row) => row.path.endsWith('/a.mp4'))?.clips).toHaveLength(1);
    expect(overview.sources.find((row) => row.path.endsWith('/b.mp4'))?.clips).toHaveLength(0);
  });

  it('puts a fully merged and cut source into the complete bucket', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [{ path: '/w/finished/finished_src_media/a.mp4', folder: 'finishedSrc' }],
      finishedClips: ['/w/finished/finished_clips/a-1.mp4'],
      finishedMerged: ['/w/finished/finished_merged/a-merge.mp4'],
    }), ci);

    expect(getPatchOverviewSourceStatus(overview.sources[0]!)).toBe('complete');
    expect(overview.stats.complete).toBe(1);
    expect(buildOverviewGroups(overview).find((group) => group.id === 'complete')?.sources).toHaveLength(1);
  });

  it('pairs a ledger entry whose source moved inside the work area by its fingerprint', () => {
    const source = '/w/detached_src_media/a.mp4';
    const overview = groupPatchResultsOverview(scan({
      sources: [{ path: source, folder: 'detachedSrc' }],
      finishedClips: ['/w/finished/finished_clips/a-1.mp4', '/w/finished/finished_clips/a-2.mp4'],
      sourceFingerprints: new Map([[normalizeManifestPath(source, ci), { size: 100, hash: 'h' }]]),
      ledger: {
        version: 1,
        entries: [
          entry({ source, clips: ['/w/finished/finished_clips/a-1.mp4'], sourceIdentity: { size: 100, hash: 'h' }, at: 2 }),
          entry({ source: '/w/a.mp4', clips: ['/w/finished/finished_clips/a-2.mp4'], sourceIdentity: { size: 100, hash: 'h' }, at: 1 }),
        ],
      },
    }), ci);

    const row = overview.sources.find((item) => item.path === source);
    expect(row?.clips.map((clip) => clip.path)).toStrictEqual(['/w/finished/finished_clips/a-1.mp4', '/w/finished/finished_clips/a-2.mp4']);
    expect(overview.stats.sourceGone).toBe(0);
    expect(overview.sources.filter((item) => item.folder === 'missing')).toStrictEqual([]);
  });

  it('does not take a same-name source whose fingerprint differs', () => {
    const source = '/w/detached_src_media/a.mp4';
    const overview = groupPatchResultsOverview(scan({
      sources: [{ path: source, folder: 'detachedSrc' }],
      finishedClips: ['/w/finished/finished_clips/a-1.mp4', '/w/finished/finished_clips/a-2.mp4'],
      sourceFingerprints: new Map([[normalizeManifestPath(source, ci), { size: 100, hash: 'other' }]]),
      ledger: {
        version: 1,
        entries: [
          entry({ source, clips: ['/w/finished/finished_clips/a-1.mp4'], sourceIdentity: { size: 100, hash: 'h' }, at: 2 }),
          entry({ source: '/w/a.mp4', clips: ['/w/finished/finished_clips/a-2.mp4'], sourceIdentity: { size: 100, hash: 'h' }, at: 1 }),
        ],
      },
    }), ci);

    expect(overview.sources.find((item) => item.path === source)?.clips.map((clip) => clip.path)).toStrictEqual(['/w/finished/finished_clips/a-1.mp4']);
    expect(overview.sources.find((item) => item.path === '/w/a.mp4')?.folder).toBe('missing');
    expect(overview.stats.sourceGone).toBe(1);
  });

  it('uses the fingerprint to choose between two sources of the same name', () => {
    const detached = '/w/detached_src_media/a.mp4';
    const finished = '/w/finished/finished_src_media/a.mp4';
    const overview = groupPatchResultsOverview(scan({
      sources: [
        { path: detached, folder: 'detachedSrc' },
        { path: finished, folder: 'finishedSrc' },
      ],
      finishedClips: ['/w/finished/finished_clips/a-1.mp4'],
      sourceFingerprints: new Map([
        [normalizeManifestPath(detached, ci), { size: 1, hash: 'detached' }],
        [normalizeManifestPath(finished, ci), { size: 2, hash: 'finished' }],
      ]),
      ledger: {
        version: 1,
        entries: [entry({ source: '/w/a.mp4', clips: ['/w/finished/finished_clips/a-1.mp4'], sourceIdentity: { size: 2, hash: 'finished' } })],
      },
    }), ci);

    expect(overview.sources.find((item) => item.path === finished)?.clips).toHaveLength(1);
    expect(overview.sources.find((item) => item.path === detached)?.clips).toHaveLength(0);
    expect(overview.stats.sourceGone).toBe(0);
  });

  it('falls back to the only same-name source for an entry written before fingerprints', () => {
    const source = '/w/detached_src_media/a.mp4';
    const overview = groupPatchResultsOverview(scan({
      sources: [{ path: source, folder: 'detachedSrc' }],
      finishedClips: ['/w/finished/finished_clips/a-1.mp4'],
      ledger: { version: 1, entries: [entry({ source: '/w/a.mp4', clips: ['/w/finished/finished_clips/a-1.mp4'] })] },
    }), ci);

    expect(overview.sources.find((item) => item.path === source)?.clips).toHaveLength(1);
    expect(overview.stats.sourceGone).toBe(0);
  });

  it('does not pair a moved entry whose source was renamed on the way', () => {
    // A later finish moved the source and, because the target name was taken, renamed it to
    // `a (1).mp4`. The name gate only looks at the entry's old name, so the fingerprint is never
    // compared with the file that exists now: the old results stay under a gone source. This is a
    // documented limit of the name-first pairing, not a data loss - the files are untouched.
    const source = '/w/detached_src_media/a (1).mp4';
    const overview = groupPatchResultsOverview(scan({
      sources: [{ path: source, folder: 'detachedSrc' }],
      finishedClips: ['/w/finished/finished_clips/a-1.mp4'],
      sourceFingerprints: new Map([[normalizeManifestPath(source, ci), { size: 100, hash: 'h' }]]),
      ledger: {
        version: 1,
        entries: [entry({
          source: '/w/finished/finished_src_media/a.mp4',
          clips: ['/w/finished/finished_clips/a-1.mp4'],
          sourceIdentity: { size: 100, hash: 'h' },
        })],
      },
    }), ci);

    expect(overview.sources.find((item) => item.path === source)?.clips).toHaveLength(0);
    expect(overview.sources.find((item) => item.folder === 'missing')?.clips.map((clip) => clip.path)).toStrictEqual(['/w/finished/finished_clips/a-1.mp4']);
    expect(overview.stats.sourceGone).toBe(1);
  });

  it('keeps a gone source when two sources share its name and no fingerprint decides', () => {
    const overview = groupPatchResultsOverview(scan({
      sources: [
        { path: '/w/detached_src_media/a.mp4', folder: 'detachedSrc' },
        { path: '/w/finished/finished_src_media/a.mp4', folder: 'finishedSrc' },
      ],
      finishedClips: ['/w/finished/finished_clips/a-1.mp4'],
      ledger: { version: 1, entries: [entry({ source: '/w/a.mp4', clips: ['/w/finished/finished_clips/a-1.mp4'] })] },
    }), ci);

    expect(overview.sources.filter((item) => item.folder === 'missing')).toHaveLength(1);
    expect(overview.stats.sourceGone).toBe(1);
  });
});
