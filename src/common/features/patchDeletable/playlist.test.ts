// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchOverviewResultRef } from '../patchResultsOverview/groupResults.js';

import { buildPatchDetachPlaylist } from './playlist.js';
import type { PatchDetachableReport, PatchDetachableSourceRow } from './rows.js';

const result = (path: string, folder: PatchOverviewResultRef['folder']): PatchOverviewResultRef => ({ path, folder });

function sourceRow(path: string, overrides: Partial<PatchDetachableSourceRow> = {}): PatchDetachableSourceRow {
  return {
    path,
    reason: 'deletable',
    deletable: true,
    clips: [],
    merged: [],
    parked: [],
    missing: [],
    pairing: 'ledger',
    ...overrides,
  };
}

function report(rows: PatchDetachableSourceRow[]): PatchDetachableReport {
  return {
    workRoot: String.raw`C:\work`,
    detachedSrcMediaDir: undefined,
    rows,
    totals: { sources: rows.length, deletable: 0, results: 0 },
    warnings: [],
  };
}

describe('buildPatchDetachPlaylist', () => {
  it('lists each source, then its clips, merged and parked results', () => {
    const entries = buildPatchDetachPlaylist(report([sourceRow(String.raw`C:\work\a.mp4`, {
      clips: [result(String.raw`C:\work\clips\a-1.mp4`, 'finishedClips')],
      merged: [result(String.raw`C:\work\merged\a-merge.mp4`, 'finishedMerged')],
      parked: [result(String.raw`C:\work\parked\a-2.mp4`, 'detachedClips')],
    })]));

    expect(entries.map((entry) => [entry.path, entry.origin])).toStrictEqual([
      [String.raw`C:\work\a.mp4`, 'detachedSrc'],
      [String.raw`C:\work\clips\a-1.mp4`, 'finishedClips'],
      [String.raw`C:\work\merged\a-merge.mp4`, 'finishedMerged'],
      [String.raw`C:\work\parked\a-2.mp4`, 'detachedClips'],
    ]);
  });

  it('groups every entry of a source under its file name', () => {
    const entries = buildPatchDetachPlaylist(report([
      sourceRow(String.raw`C:\work\a.mp4`, { clips: [result(String.raw`C:\work\clips\a-1.mp4`, 'finishedClips')] }),
      sourceRow(String.raw`C:\work\b.mkv`),
    ]));

    expect(entries.map((entry) => entry.group)).toStrictEqual(['a.mp4', 'a.mp4', 'b.mkv']);
    expect(entries.map((entry) => entry.sourcePath)).toStrictEqual([
      String.raw`C:\work\a.mp4`,
      String.raw`C:\work\a.mp4`,
      String.raw`C:\work\b.mkv`,
    ]);
  });

  it('skips the results that are only in the ledger', () => {
    const entries = buildPatchDetachPlaylist(report([sourceRow(String.raw`C:\work\a.mp4`, {
      missing: [String.raw`C:\work\clips\a-gone.mp4`],
    })]));

    expect(entries.map((entry) => entry.path)).toStrictEqual([String.raw`C:\work\a.mp4`]);
  });

  it('has no entries without a report', () => {
    expect(buildPatchDetachPlaylist(undefined)).toStrictEqual([]);
  });
});
