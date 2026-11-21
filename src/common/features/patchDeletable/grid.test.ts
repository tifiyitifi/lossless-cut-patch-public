// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import type { PatchOverviewResultRef } from '../patchResultsOverview/groupResults.js';

import {
  buildPatchDetachGrid,
  computePatchDetachGroupLayout,
  flattenPatchDetachGrid,
  getPatchDetachColumnRule,
  getPatchDetachGroupMinWidth,
  getPatchDetachTileWidth,
  parsePatchDetachGroupsPerRow,
  parsePatchDetachSourceColumnWidths,
  parsePatchDetachGridView,
  patchDetachCardGap,
  patchDetachColumnRuleGap,
  patchDetachColumnRuleWidth,
  patchDetachGridDefaultView,
  patchDetachGridViews,
  patchDetachGroupGap,
  patchDetachGroupInnerGap,
  patchDetachGroupPadding,
  patchDetachGroupsPerRowDefault,
  patchDetachResultsInset,
} from './grid.js';
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
    detachedSrcMediaDir: String.raw`C:\work\.losslesscut_work\detached_src_media`,
    rows,
    totals: { sources: rows.length, deletable: rows.filter((row) => row.deletable).length, results: 0 },
    warnings: [],
  };
}

describe('buildPatchDetachGrid', () => {
  it('puts the source first, then its clips, merged and parked results', () => {
    const [row] = buildPatchDetachGrid(report([sourceRow(String.raw`C:\work\a.mp4`, {
      clips: [result(String.raw`C:\work\finished_clips\a-1.mp4`, 'finishedClips')],
      merged: [result(String.raw`C:\work\finished_merged\a-merge.mp4`, 'finishedMerged')],
      parked: [result(String.raw`C:\work\detached_clips\a-2.mp4`, 'detachedClips')],
    })]));

    expect(row?.items.map((item) => [item.kind, item.path, item.origin])).toStrictEqual([
      ['source', String.raw`C:\work\a.mp4`, 'detachedSrc'],
      ['result', String.raw`C:\work\finished_clips\a-1.mp4`, 'finishedClips'],
      ['result', String.raw`C:\work\finished_merged\a-merge.mp4`, 'finishedMerged'],
      ['result', String.raw`C:\work\detached_clips\a-2.mp4`, 'detachedClips'],
    ]);
  });

  it('keys sources and results apart, and points results at their source', () => {
    const [row] = buildPatchDetachGrid(report([sourceRow(String.raw`C:\work\a.mp4`, {
      clips: [result(String.raw`C:\work\a.mp4`, 'finishedClips')],
    })]));

    expect(row?.items.map((item) => item.key)).toStrictEqual([String.raw`source:C:\work\a.mp4`, String.raw`result:C:\work\a.mp4`]);
    expect(row?.items.every((item) => item.sourcePath === String.raw`C:\work\a.mp4`)).toBe(true);
    expect(row?.items.every((item) => item.selectable)).toBe(true);
  });

  it('carries the source reason, its deletable flag and the result folder', () => {
    const [row] = buildPatchDetachGrid(report([
      sourceRow(String.raw`C:\work\a.mp4`, {
        reason: 'no-results',
        deletable: false,
        clips: [result(String.raw`C:\work\finished_clips\a-1.mp4`, 'finishedClips')],
      }),
    ]));

    expect(row?.items[0]).toMatchObject({ kind: 'source', reason: 'no-results', deletable: false });
    expect(row?.items[1]).toMatchObject({ kind: 'result', resultFolder: 'finishedClips', deletable: false });
    expect(row?.items[1]).not.toHaveProperty('reason');
  });

  it('keeps a missing result out of the items and in the row', () => {
    const [row] = buildPatchDetachGrid(report([sourceRow(String.raw`C:\work\a.mp4`, {
      missing: [String.raw`C:\work\finished_clips\a-gone.mp4`],
    })]));

    expect(row?.items.map((item) => item.kind)).toStrictEqual(['source']);
    expect(row?.missing).toStrictEqual([String.raw`C:\work\finished_clips\a-gone.mp4`]);
  });

  it('has no rows without a report', () => {
    expect(buildPatchDetachGrid(undefined)).toStrictEqual([]);
  });
});

describe('flattenPatchDetachGrid', () => {
  it('lists every item row by row, the source before its results', () => {
    const rows = buildPatchDetachGrid(report([
      sourceRow(String.raw`C:\work\a.mp4`, { clips: [result(String.raw`C:\work\clips\a-1.mp4`, 'finishedClips')] }),
      sourceRow(String.raw`C:\work\b.mp4`),
    ]));

    expect(flattenPatchDetachGrid(rows).map((item) => item.key)).toStrictEqual([
      String.raw`source:C:\work\a.mp4`,
      String.raw`result:C:\work\clips\a-1.mp4`,
      String.raw`source:C:\work\b.mp4`,
    ]);
  });
});

describe('view presets', () => {
  it('offers list, compact, standard and large, with standard as the default', () => {
    expect(patchDetachGridViews).toStrictEqual(['list', 'compact', 'standard', 'large']);
    expect(patchDetachGridDefaultView).toBe('standard');
  });

  it('reads a stored view and falls back to the default', () => {
    expect(parsePatchDetachGridView('large')).toBe('large');
    expect(parsePatchDetachGridView('list')).toBe('list');
    expect(parsePatchDetachGridView('huge')).toBe('standard');
    expect(parsePatchDetachGridView(200)).toBe('standard');
    expect(parsePatchDetachGridView(undefined)).toBe('standard');
  });

  it('gives the tile presets a width and the list preset none', () => {
    expect(getPatchDetachTileWidth('compact')).toBe(140);
    expect(getPatchDetachTileWidth('standard')).toBe(200);
    expect(getPatchDetachTileWidth('large')).toBe(300);
    expect(getPatchDetachTileWidth('list')).toBeUndefined();
  });

  it('clamps the group count and falls back to the default', () => {
    expect(patchDetachGroupsPerRowDefault).toBe(2);
    expect(parsePatchDetachGroupsPerRow(1)).toBe(1);
    expect(parsePatchDetachGroupsPerRow(4)).toBe(4);
    expect(parsePatchDetachGroupsPerRow(3.4)).toBe(3);
    expect(parsePatchDetachGroupsPerRow(0)).toBe(1);
    expect(parsePatchDetachGroupsPerRow(99)).toBe(6);
    expect(parsePatchDetachGroupsPerRow('many')).toBe(2);
    expect(parsePatchDetachGroupsPerRow(NaN)).toBe(2);
    expect(parsePatchDetachGroupsPerRow(undefined)).toBe(2);
  });

  it('normalizes the source column widths to the group count, keeping 0 for "not set"', () => {
    expect(parsePatchDetachSourceColumnWidths(undefined, 2)).toStrictEqual([0, 0]);
    expect(parsePatchDetachSourceColumnWidths([320, 410], 2)).toStrictEqual([320, 410]);
    expect(parsePatchDetachSourceColumnWidths([320, 'wide', -5, 0, 2.6], 4)).toStrictEqual([320, 0, 0, 0]);
    expect(parsePatchDetachSourceColumnWidths([320.4, NaN], 2)).toStrictEqual([320, 0]);
    expect(parsePatchDetachSourceColumnWidths(undefined, 3)).toStrictEqual([0, 0, 0]);
  });

  it('measures a group panel in pixels', () => {
    // One source card, the inner gap, one result card, the panel padding and its border.
    expect(getPatchDetachGroupMinWidth(200)).toBe(200 + patchDetachGroupInnerGap + 200 + 2 * patchDetachGroupPadding + 2);
  });

  it('splits the inner gap into the space before the rule, the rule and the space after it', () => {
    expect(patchDetachGroupInnerGap).toBe(patchDetachColumnRuleGap + patchDetachColumnRuleWidth + patchDetachResultsInset);
  });

  it('centers the rule, so it is as far from the source card as from the first result card', () => {
    // The card's own border and padding are inside its width (`box-sizing: border-box`), so these
    // two are the visible distances: a rule that hugged the source card would read as its edge.
    expect(patchDetachColumnRuleGap).toBe(patchDetachResultsInset);
    expect(patchDetachColumnRuleGap).toBeGreaterThan(patchDetachCardGap);
  });

  it('keeps the source/result gutter clearly wider than two result cards, and the group gap wider still', () => {
    // This hierarchy is the whole point of the layout: results sit close together, a group's two
    // columns are visibly apart, and two groups are further apart than the columns inside one.
    expect(patchDetachGroupInnerGap).toBeGreaterThan(patchDetachCardGap * 2);
    expect(patchDetachGroupGap).toBeGreaterThan(patchDetachGroupInnerGap);
  });

  it('puts the column rule in the gutter and centers its drag handle on it', () => {
    const rule = getPatchDetachColumnRule(240);
    expect(rule.left).toBe(240 + patchDetachColumnRuleGap);
    expect(rule.width).toBe(patchDetachColumnRuleWidth);
    // The handle is wider than the line, so grabbing the line is enough; its center is the line's.
    expect(rule.handleWidth).toBeGreaterThan(rule.width);
    expect(rule.handleLeft + rule.handleWidth / 2).toBe(rule.left + rule.width / 2);
    // The rule never leaves the room the gutter reserves for it.
    expect(rule.left + rule.width + patchDetachResultsInset).toBe(240 + patchDetachGroupInnerGap);
  });
});

describe('computePatchDetachGroupLayout', () => {
  const layout = (overrides: Partial<Parameters<typeof computePatchDetachGroupLayout>[0]> = {}) => computePatchDetachGroupLayout({
    availableWidth: 1000,
    tileWidth: 200,
    savedGroups: 2,
    savedSourceWidths: [0, 0],
    ...overrides,
  });

  it('splits the row into equal groups and defaults a source column to one card', () => {
    expect(layout()).toStrictEqual({
      groups: 2,
      groupWidth: (1000 - patchDetachGroupGap) / 2,
      sourceWidths: [200, 200],
      minSourceWidth: 200,
      maxSourceWidth: (1000 - patchDetachGroupGap) / 2 - 2 * (patchDetachGroupPadding + 1) - patchDetachGroupInnerGap - 200,
    });
  });

  it('never shows more groups than the saved maximum', () => {
    expect(layout({ availableWidth: 5000 }).groups).toBe(2);
  });

  it('shows fewer groups when the window cannot hold them side by side', () => {
    // Two groups need 2 * minGroupWidth + the gap between them.
    const one = layout({ availableWidth: 700 });
    expect(one.groups).toBe(1);
    expect(one.groupWidth).toBe(700);
  });

  it('keeps at least one group even in a very narrow window', () => {
    expect(layout({ availableWidth: 100 }).groups).toBe(1);
  });

  it('keeps a free pixel width between one card and one remaining result card', () => {
    const wide = layout({ availableWidth: 2000, savedSourceWidths: [317, 402] });
    expect(wide.sourceWidths).toStrictEqual([317, 402]);
    expect(wide.minSourceWidth).toBe(200);
  });

  it('clamps a source column so that at least one result card still fits', () => {
    const narrow = layout({ availableWidth: 1100, savedSourceWidths: [900, 900] });
    expect(narrow.groups).toBe(2);
    expect(narrow.sourceWidths).toStrictEqual([narrow.maxSourceWidth, narrow.maxSourceWidth]);
    expect(narrow.maxSourceWidth).toBeGreaterThanOrEqual(narrow.minSourceWidth);
  });

  it('falls back to one card when the saved width would squeeze the results', () => {
    const tiny = layout({ availableWidth: 100 });
    expect(tiny.sourceWidths).toStrictEqual([200]);
  });

  it('leaves the saved source widths alone', () => {
    const savedSourceWidths = [400, 320];
    layout({ availableWidth: 2000, savedSourceWidths });
    expect(savedSourceWidths).toStrictEqual([400, 320]);
  });
});
