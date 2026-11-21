// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { applyRangeXor, emptyMultiSelection, isExportSelectionEmpty, planMultiSelectAction, pruneMultiSelection, summarizeMultiSelection } from './multiSelect.js';
import type { MultiSelectRow, MultiSelection } from './multiSelect.js';

const rows: MultiSelectRow[] = [
  { segId: 'a', start: 0, end: 10 },
  { segId: 'b', start: 10, end: 20 },
  { segId: 'c', start: 20, end: 30 },
  { segId: 'd', start: 30, end: 40 },
];

function selectionOf(ids: string[], anchorSegId?: string): MultiSelection {
  return { anchorSegId, selectedIds: new Set(ids) };
}

describe('applyRangeXor', () => {
  it('starts the selection with the clicked row when there is no anchor', () => {
    const next = applyRangeXor({ rows, selection: emptyMultiSelection, targetSegId: 'b' });
    expect(next.anchorSegId).toBe('b');
    expect([...next.selectedIds]).toStrictEqual(['b']);
  });

  it('toggles the clicked row when it is the anchor', () => {
    const first = applyRangeXor({ rows, selection: emptyMultiSelection, targetSegId: 'b' });
    const second = applyRangeXor({ rows, selection: first, targetSegId: 'b' });
    expect(second.anchorSegId).toBe('b');
    expect([...second.selectedIds]).toStrictEqual([]);
  });

  it('toggles the rows between the anchor and the target, skipping the anchor', () => {
    const selection = selectionOf(['b'], 'b');
    const next = applyRangeXor({ rows, selection, targetSegId: 'd' });
    expect(next.anchorSegId).toBe('d');
    expect([...next.selectedIds]).toStrictEqual(['b', 'c', 'd']);
  });

  it('works backwards as well', () => {
    const selection = selectionOf(['c'], 'c');
    const next = applyRangeXor({ rows, selection, targetSegId: 'a' });
    expect(next.anchorSegId).toBe('a');
    expect([...next.selectedIds].sort()).toStrictEqual(['a', 'b', 'c']);
  });

  it('reopens a block that was already selected, leaving the old anchor selected', () => {
    const selection = selectionOf(['a', 'b', 'c'], 'c');
    const next = applyRangeXor({ rows, selection, targetSegId: 'a' });
    expect(next.anchorSegId).toBe('a');
    expect([...next.selectedIds]).toStrictEqual(['c']);
  });

  it('does not change the export selection', () => {
    // The pure function only returns the temporary set: `segment.selected` is the caller's.
    const next = applyRangeXor({ rows, selection: emptyMultiSelection, targetSegId: 'a' });
    expect(next).not.toHaveProperty('selected');
  });

  it('ignores a row that is not in the list', () => {
    const selection = selectionOf(['a'], 'a');
    expect(applyRangeXor({ rows, selection, targetSegId: 'gone' })).toBe(selection);
  });

  it('starts over when the anchor is gone', () => {
    const selection = selectionOf(['a', 'b'], 'gone');
    const next = applyRangeXor({ rows, selection, targetSegId: 'd' });
    expect(next.anchorSegId).toBe('d');
    expect([...next.selectedIds].sort()).toStrictEqual(['a', 'b', 'd']);
  });

  it('handles an empty list', () => {
    expect(applyRangeXor({ rows: [], selection: emptyMultiSelection, targetSegId: 'a' })).toBe(emptyMultiSelection);
  });
});

describe('pruneMultiSelection', () => {
  it('drops rows and anchors the list no longer has', () => {
    const next = pruneMultiSelection({ rows: rows.slice(0, 2), selection: selectionOf(['a', 'd'], 'd') });
    expect([...next.selectedIds]).toStrictEqual(['a']);
    expect(next.anchorSegId).toBeUndefined();
  });

  it('returns the same object when nothing changed', () => {
    const selection = selectionOf(['a'], 'a');
    expect(pruneMultiSelection({ rows, selection })).toBe(selection);
    expect(pruneMultiSelection({ rows, selection: emptyMultiSelection })).toBe(emptyMultiSelection);
  });
});

describe('summarizeMultiSelection', () => {
  it('counts the rows in list order and sums their duration', () => {
    const summary = summarizeMultiSelection({ rows, selection: selectionOf(['d', 'b']) });
    expect(summary.selectedIds).toStrictEqual(['b', 'd']);
    expect(summary.count).toBe(2);
    expect(summary.duration).toBe(20);
  });

  it('counts a marker but gives it no duration', () => {
    const withMarker = [...rows, { segId: 'marker', start: 50 }];
    const summary = summarizeMultiSelection({ rows: withMarker, selection: selectionOf(['marker']) });
    expect(summary.count).toBe(1);
    expect(summary.duration).toBe(0);
  });

  it('counts a marker in the total but not among the exportable rows', () => {
    const withMarker = [...rows, { segId: 'marker', start: 50 }];
    const summary = summarizeMultiSelection({ rows: withMarker, selection: selectionOf(['b', 'marker']) });
    expect(summary.count).toBe(2);
    expect(summary.exportableCount).toBe(1);
    expect(summary.exportableIds).toStrictEqual(['b']);
  });
});

describe('planMultiSelectAction', () => {
  it('deletes the rows of the selection', () => {
    expect(planMultiSelectAction({ action: 'delete', rows, selection: selectionOf(['b', 'c']) }))
      .toStrictEqual({ kind: 'remove', segIds: ['b', 'c'] });
  });

  it('marks the rows exported or not exported', () => {
    expect(planMultiSelectAction({ action: 'select', rows, selection: selectionOf(['a']) }))
      .toStrictEqual({ kind: 'selection', mode: 'select', segIds: ['a'] });
    expect(planMultiSelectAction({ action: 'deselect', rows, selection: selectionOf(['a']) }))
      .toStrictEqual({ kind: 'selection', mode: 'deselect', segIds: ['a'] });
  });

  it('keeps only the rows of the selection', () => {
    expect(planMultiSelectAction({ action: 'only', rows, selection: selectionOf(['a', 'c']) }))
      .toStrictEqual({ kind: 'selection', mode: 'only', segIds: ['a', 'c'] });
  });

  it('keeps only the exportable rows, never the markers', () => {
    // A marker has no end time, so it is never exported. Keeping "only" the markers would deselect
    // every real segment, and upstream then falls back to exporting all of them.
    const withMarker = [...rows, { segId: 'marker', start: 50 }];
    expect(planMultiSelectAction({ action: 'only', rows: withMarker, selection: selectionOf(['a', 'marker']) }))
      .toStrictEqual({ kind: 'selection', mode: 'only', segIds: ['a'] });
  });

  it('does nothing on "only" when the selection holds nothing exportable', () => {
    const withMarker = [...rows, { segId: 'marker', start: 50 }];
    expect(planMultiSelectAction({ action: 'only', rows: withMarker, selection: selectionOf(['marker']) }))
      .toStrictEqual({ kind: 'none' });
  });

  it('still deletes and marks a marker selection', () => {
    // Markers are real rows: only the export of them is meaningless.
    const withMarker = [...rows, { segId: 'marker', start: 50 }];
    expect(planMultiSelectAction({ action: 'delete', rows: withMarker, selection: selectionOf(['marker']) }))
      .toStrictEqual({ kind: 'remove', segIds: ['marker'] });
    expect(planMultiSelectAction({ action: 'select', rows: withMarker, selection: selectionOf(['marker']) }))
      .toStrictEqual({ kind: 'selection', mode: 'select', segIds: ['marker'] });
  });

  it('does nothing on an empty selection', () => {
    for (const action of ['delete', 'select', 'deselect', 'only'] as const) {
      expect(planMultiSelectAction({ action, rows, selection: emptyMultiSelection })).toStrictEqual({ kind: 'none' });
    }
  });

  it('does nothing when the selection only holds rows that are gone', () => {
    expect(planMultiSelectAction({ action: 'delete', rows, selection: selectionOf(['gone']) })).toStrictEqual({ kind: 'none' });
  });
});

describe('isExportSelectionEmpty', () => {
  it('is false while a segment is exported', () => {
    expect(isExportSelectionEmpty([{ end: 10, selected: true }, { end: 20, selected: false }])).toBe(false);
  });

  it('is true when no segment with an end time is exported', () => {
    expect(isExportSelectionEmpty([{ end: 10, selected: false }, { end: 20, selected: false }])).toBe(true);
    expect(isExportSelectionEmpty([{ end: 10, selected: undefined }])).toBe(true);
  });

  it('ignores markers and an empty list', () => {
    expect(isExportSelectionEmpty([{ selected: false }])).toBe(false);
    expect(isExportSelectionEmpty([])).toBe(false);
  });
});
