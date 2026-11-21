// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import {
  countPatchDetachSelection,
  emptyPatchDetachSelection,
  planPatchDetachClick,
  planPatchDetachDelete,
  planPatchDetachSelectKind,
  planPatchDetachSelectNoneKind,
  prunePatchDetachSelection,
} from './selection.js';
import type { PatchDetachSelectable, PatchDetachSelection } from './selection.js';

/** The visual order of a two-source grid: each source, then its result; one broken result at the end. */
const items: PatchDetachSelectable[] = [
  { key: 'source:a.mp4', path: 'a.mp4', kind: 'source', deletable: true, selectable: true },
  { key: 'result:a-1.mp4', path: 'a-1.mp4', kind: 'result', deletable: false, selectable: true },
  { key: 'source:b.mp4', path: 'b.mp4', kind: 'source', deletable: false, selectable: true },
  { key: 'result:b-1.mp4', path: 'b-1.mp4', kind: 'result', deletable: false, selectable: true },
  { key: 'result:broken.mp4', path: 'broken.mp4', kind: 'result', deletable: false, selectable: false },
];

const selectionOf = (keys: string[], anchor?: string): PatchDetachSelection => ({
  selected: new Set(keys),
  anchor: anchor ?? keys[0],
});

const selectedKeys = (selection: PatchDetachSelection) => [...selection.selected];

describe('planPatchDetachClick', () => {
  it('selects only the clicked item and makes it the anchor', () => {
    const next = planPatchDetachClick({ items, selection: emptyPatchDetachSelection(), key: 'source:a.mp4', extend: false, toggle: false });

    expect(selectedKeys(next)).toStrictEqual(['source:a.mp4']);
    expect(next.anchor).toBe('source:a.mp4');
  });

  it('deselects the item when it was the only selected one', () => {
    const next = planPatchDetachClick({ items, selection: selectionOf(['source:a.mp4']), key: 'source:a.mp4', extend: false, toggle: false });

    expect(selectedKeys(next)).toStrictEqual([]);
    expect(next.anchor).toBeUndefined();
  });

  it('replaces the previous selection', () => {
    const next = planPatchDetachClick({ items, selection: selectionOf(['source:a.mp4', 'result:a-1.mp4']), key: 'source:b.mp4', extend: false, toggle: false });

    expect(selectedKeys(next)).toStrictEqual(['source:b.mp4']);
    expect(next.anchor).toBe('source:b.mp4');
  });

  it('adds and removes one item with Ctrl, keeping the rest', () => {
    const one = planPatchDetachClick({ items, selection: emptyPatchDetachSelection(), key: 'source:a.mp4', extend: false, toggle: true });
    const two = planPatchDetachClick({ items, selection: one, key: 'result:b-1.mp4', extend: false, toggle: true });
    expect(selectedKeys(two)).toStrictEqual(['source:a.mp4', 'result:b-1.mp4']);
    expect(two.anchor).toBe('result:b-1.mp4');

    const removed = planPatchDetachClick({ items, selection: two, key: 'source:a.mp4', extend: false, toggle: true });
    expect(selectedKeys(removed)).toStrictEqual(['result:b-1.mp4']);
    expect(removed.anchor).toBe('source:a.mp4');
  });

  it('selects the stretch from the anchor across both columns', () => {
    const next = planPatchDetachClick({ items, selection: selectionOf(['source:a.mp4']), key: 'result:b-1.mp4', extend: true, toggle: false });

    expect(selectedKeys(next)).toStrictEqual(['source:a.mp4', 'result:a-1.mp4', 'source:b.mp4', 'result:b-1.mp4']);
    expect(next.anchor).toBe('source:a.mp4');
  });

  it('replaces the previous selection with the stretch and keeps the anchor', () => {
    const previous = selectionOf(['result:b-1.mp4'], 'source:a.mp4');
    const next = planPatchDetachClick({ items, selection: previous, key: 'source:b.mp4', extend: true, toggle: false });

    expect(selectedKeys(next)).toStrictEqual(['source:a.mp4', 'result:a-1.mp4', 'source:b.mp4']);
    expect(next.anchor).toBe('source:a.mp4');
  });

  it('extends upwards in visual order', () => {
    const next = planPatchDetachClick({ items, selection: selectionOf(['result:b-1.mp4']), key: 'result:a-1.mp4', extend: true, toggle: false });

    expect(selectedKeys(next)).toStrictEqual(['result:a-1.mp4', 'source:b.mp4', 'result:b-1.mp4']);
  });

  it('treats Shift without an anchor as a plain click', () => {
    const next = planPatchDetachClick({ items, selection: emptyPatchDetachSelection(), key: 'source:b.mp4', extend: true, toggle: false });

    expect(selectedKeys(next)).toStrictEqual(['source:b.mp4']);
    expect(next.anchor).toBe('source:b.mp4');
  });

  it('treats Shift with a vanished anchor as a plain click', () => {
    const stale = selectionOf(['source:a.mp4'], 'source:gone.mp4');
    const next = planPatchDetachClick({ items, selection: stale, key: 'result:b-1.mp4', extend: true, toggle: false });

    expect(selectedKeys(next)).toStrictEqual(['result:b-1.mp4']);
    expect(next.anchor).toBe('result:b-1.mp4');
  });

  it('ignores a click on a non-selectable or unknown item', () => {
    const selection = selectionOf(['source:a.mp4']);
    expect(planPatchDetachClick({ items, selection, key: 'result:broken.mp4', extend: false, toggle: false })).toBe(selection);
    expect(planPatchDetachClick({ items, selection, key: 'result:broken.mp4', extend: false, toggle: true })).toBe(selection);
    expect(planPatchDetachClick({ items, selection, key: 'result:zz.mp4', extend: true, toggle: false })).toBe(selection);
  });
});

describe('planPatchDetachSelectKind', () => {
  it('selects every source and keeps the results already selected', () => {
    const next = planPatchDetachSelectKind({ items, selection: selectionOf(['result:a-1.mp4']), kind: 'source' });

    expect(selectedKeys(next)).toStrictEqual(['result:a-1.mp4', 'source:a.mp4', 'source:b.mp4']);
    expect(next.anchor).toBe('source:a.mp4');
  });

  it('selects every result of the column', () => {
    const next = planPatchDetachSelectKind({ items, selection: emptyPatchDetachSelection(), kind: 'result' });

    expect(selectedKeys(next)).toStrictEqual(['result:a-1.mp4', 'result:b-1.mp4']);
  });

  it('keeps the selection when the column is empty', () => {
    const sourcesOnly = items.filter((item) => item.kind === 'source');
    const selection = selectionOf(['source:a.mp4']);
    expect(planPatchDetachSelectKind({ items: sourcesOnly, selection, kind: 'result' })).toBe(selection);
  });
});

describe('planPatchDetachSelectNoneKind', () => {
  it('clears one column and keeps the other', () => {
    const selection = selectionOf(['source:a.mp4', 'result:a-1.mp4']);
    const next = planPatchDetachSelectNoneKind({ items, selection, kind: 'result' });

    expect(selectedKeys(next)).toStrictEqual(['source:a.mp4']);
    expect(next.anchor).toBe('source:a.mp4');
  });

  it('clears the anchor when it belongs to the cleared column', () => {
    const selection = selectionOf(['source:a.mp4', 'result:a-1.mp4'], 'result:a-1.mp4');
    const next = planPatchDetachSelectNoneKind({ items, selection, kind: 'result' });

    expect(selectedKeys(next)).toStrictEqual(['source:a.mp4']);
    expect(next.anchor).toBeUndefined();
  });

  it('keeps the selection when nothing of that column was selected', () => {
    const selection = selectionOf(['source:a.mp4']);
    expect(planPatchDetachSelectNoneKind({ items, selection, kind: 'result' })).toBe(selection);
  });
});

describe('prunePatchDetachSelection', () => {
  it('drops the items a rescan removed and keeps the rest', () => {
    const fewer = items.filter((item) => item.key !== 'result:a-1.mp4');
    const next = prunePatchDetachSelection({ items: fewer, selection: selectionOf(['source:a.mp4', 'result:a-1.mp4']) });

    expect(selectedKeys(next)).toStrictEqual(['source:a.mp4']);
    expect(next.anchor).toBe('source:a.mp4');
  });

  it('clears a selected item that became non-selectable and an anchor that is gone', () => {
    const next = prunePatchDetachSelection({ items, selection: selectionOf(['result:broken.mp4'], 'result:broken.mp4') });

    expect(selectedKeys(next)).toStrictEqual([]);
    expect(next.anchor).toBeUndefined();
  });

  it('returns the same object when nothing changed', () => {
    const selection = selectionOf(['source:a.mp4']);
    expect(prunePatchDetachSelection({ items, selection })).toBe(selection);
  });
});

describe('planPatchDetachDelete', () => {
  it('deletes the selected sources, in visual order, and never a selected result', () => {
    const plan = planPatchDetachDelete({ items, selected: new Set(['result:a-1.mp4', 'source:a.mp4']) });

    expect(plan).toStrictEqual({ scope: 'selection', paths: ['a.mp4'], extraCount: 0 });
  });

  it('offers every source that is ready for deletion when nothing is selected', () => {
    const plan = planPatchDetachDelete({ items, selected: new Set() });

    // Only a.mp4 has a kept result on disk; b.mp4 is shown but cannot be deleted.
    expect(plan).toStrictEqual({ scope: 'all', paths: ['a.mp4'], extraCount: 0 });
  });

  it('stays disabled when a selection holds only results or undeletable sources', () => {
    expect(planPatchDetachDelete({ items, selected: new Set(['result:a-1.mp4']) })).toStrictEqual({ scope: 'selection', paths: [], extraCount: 0 });
    expect(planPatchDetachDelete({ items, selected: new Set(['source:b.mp4']) })).toStrictEqual({ scope: 'selection', paths: [], extraCount: 0 });
  });

  it('has nothing to delete when no source is ready for deletion', () => {
    const undeletable = items.map((item) => ({ ...item, deletable: false }));
    expect(planPatchDetachDelete({ items: undeletable, selected: new Set() })).toStrictEqual({ scope: 'selection', paths: [], extraCount: 0 });
  });
});

describe('planPatchDetachDelete with extra kinds', () => {
  // a = kept result, b/c = deletable only by the extra setting, d = not deletable.
  const withExtras: PatchDetachSelectable[] = [
    { key: 'source:a.mp4', path: 'a.mp4', kind: 'source', deletable: true, selectable: true },
    { key: 'source:b.mp4', path: 'b.mp4', kind: 'source', deletable: true, extraDeletable: true, selectable: true },
    { key: 'source:c.mp4', path: 'c.mp4', kind: 'source', deletable: true, extraDeletable: true, selectable: true },
    { key: 'source:d.mp4', path: 'd.mp4', kind: 'source', deletable: false, selectable: true },
  ];

  it('leaves the extra sources out of "Delete all" unless the setting allows them', () => {
    expect(planPatchDetachDelete({ items: withExtras, selected: new Set() }))
      .toStrictEqual({ scope: 'all', paths: ['a.mp4'], extraCount: 0 });
    expect(planPatchDetachDelete({ items: withExtras, selected: new Set(), includeExtraInAll: true }))
      .toStrictEqual({ scope: 'all', paths: ['a.mp4', 'b.mp4', 'c.mp4'], extraCount: 2 });
  });

  it('always deletes a selected extra source, whatever the "Delete all" setting says', () => {
    expect(planPatchDetachDelete({ items: withExtras, selected: new Set(['source:b.mp4']) }))
      .toStrictEqual({ scope: 'selection', paths: ['b.mp4'], extraCount: 1 });
  });

  it('has nothing to do when only extra sources exist and "Delete all" excludes them', () => {
    const onlyExtras = withExtras.filter((item) => item.extraDeletable === true);
    expect(planPatchDetachDelete({ items: onlyExtras, selected: new Set() }))
      .toStrictEqual({ scope: 'selection', paths: [], extraCount: 0 });
    expect(planPatchDetachDelete({ items: onlyExtras, selected: new Set(), includeExtraInAll: true }))
      .toStrictEqual({ scope: 'all', paths: ['b.mp4', 'c.mp4'], extraCount: 2 });
  });
});

describe('countPatchDetachSelection', () => {
  it('counts one column only', () => {
    const selection = selectionOf(['source:a.mp4', 'source:b.mp4', 'result:a-1.mp4']);

    expect(countPatchDetachSelection({ items, selection, kind: 'source' })).toBe(2);
    expect(countPatchDetachSelection({ items, selection, kind: 'result' })).toBe(1);
  });

  it('ignores non-selectable items', () => {
    const selection = selectionOf(['result:broken.mp4']);

    expect(countPatchDetachSelection({ items, selection, kind: 'result' })).toBe(0);
  });
});
