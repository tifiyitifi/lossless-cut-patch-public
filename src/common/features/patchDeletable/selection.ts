import type { PatchDetachGridItem, PatchDetachGridItemKind } from './grid.js';

/**
Selecting files in the deletion check (fork-owned, pure).

The grid holds sources and results in one visual order (see `grid.ts`), and the selection follows the
gestures a Windows file list has:

- a click selects that item and nothing else; clicking the only selected item again deselects it;
- Ctrl+click adds or removes one item without touching the rest;
- Shift+click selects the stretch from the anchor to the clicked item (both ends included) and
  replaces the previous selection; a Shift+click without a usable anchor is a plain click;
- a card's buttons (play, deep check, locate) never change the selection;
- select all / none are per column: the source column and the result column are handled separately.

The selection stores item keys (`source:<path>` / `result:<path>`) and an anchor key. A key makes the
two kinds apart even if a result happens to have the same path as a source; a path would not. The
anchor is a key, not an index: the panel rescans after every delete, and a row that moved must not
extend a range from whatever now sits at the old position.

Nothing here decides whether a file is safe to delete: `deletable` is carried along so
`planPatchDetachDelete` can say which sources a delete covers, but every item can be selected, played
and deep-checked.
*/

export type PatchDetachSelectable = Pick<PatchDetachGridItem, 'key' | 'path' | 'kind' | 'deletable' | 'extraDeletable' | 'selectable'>;

export interface PatchDetachSelection {
  readonly selected: ReadonlySet<string>;
  /** The item a Shift+click measures from; `undefined` before the first click or after clearing. */
  readonly anchor: string | undefined;
}

export function emptyPatchDetachSelection(): PatchDetachSelection {
  return { selected: new Set(), anchor: undefined };
}

function withSelection(selected: ReadonlySet<string>, anchor: string | undefined): PatchDetachSelection {
  return { selected, anchor };
}

/** The selectable keys between two item keys, both ends included, in visual order. */
function rangeBetween(items: readonly PatchDetachSelectable[], from: string, to: string): string[] {
  const fromIndex = items.findIndex((item) => item.key === from);
  const toIndex = items.findIndex((item) => item.key === to);
  if (fromIndex === -1 || toIndex === -1) return [];
  const [start, end] = fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
  return items.slice(start, end + 1).filter((item) => item.selectable).map((item) => item.key);
}

/**
One click on a card.

`extend` is the Shift state, `toggle` the Ctrl/Cmd state. A Shift+click whose anchor item is gone or
not selectable any more behaves like a plain click, exactly as a file list does.
*/
export function planPatchDetachClick({ items, selection, key, extend, toggle }: {
  items: readonly PatchDetachSelectable[];
  selection: PatchDetachSelection;
  key: string;
  extend: boolean;
  toggle: boolean;
}): PatchDetachSelection {
  const clicked = items.find((item) => item.key === key);
  if (clicked?.selectable !== true) return selection;

  if (extend) {
    const { anchor } = selection;
    const anchorUsable = anchor != null && items.some((item) => item.key === anchor && item.selectable);
    if (anchorUsable) return withSelection(new Set(rangeBetween(items, anchor, key)), anchor);
    // No usable anchor: fall through to the plain-click rules below.
  }

  if (toggle) {
    const selected = new Set(selection.selected);
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    return withSelection(selected, key);
  }

  // Clicking the only selected card again clears the selection; clicking any other card selects it.
  if (selection.selected.size === 1 && selection.selected.has(key)) return withSelection(new Set(), undefined);
  return withSelection(new Set([key]), key);
}

/** Select every selectable item of one column, keeping the other column's selection. */
export function planPatchDetachSelectKind({ items, selection, kind }: {
  items: readonly PatchDetachSelectable[];
  selection: PatchDetachSelection;
  kind: PatchDetachGridItemKind;
}): PatchDetachSelection {
  const keys = items.filter((item) => item.kind === kind && item.selectable).map((item) => item.key);
  if (keys.length === 0) return selection;
  const selected = new Set(selection.selected);
  for (const key of keys) selected.add(key);
  return withSelection(selected, keys[0]);
}

/** Clear one column, keeping the other column's selection. */
export function planPatchDetachSelectNoneKind({ items, selection, kind }: {
  items: readonly PatchDetachSelectable[];
  selection: PatchDetachSelection;
  kind: PatchDetachGridItemKind;
}): PatchDetachSelection {
  const kindKeys = new Set(items.filter((item) => item.kind === kind).map((item) => item.key));
  const selected = [...selection.selected].filter((key) => !kindKeys.has(key));
  const anchorCleared = selection.anchor != null && kindKeys.has(selection.anchor);
  if (!anchorCleared && selected.length === selection.selected.size) return selection;
  return withSelection(new Set(selected), anchorCleared ? undefined : selection.anchor);
}

/**
Drop the items a delete (or a rescan) took away.

A selected key that is not selectable any more is not selected; an anchor that is gone is cleared, so
the next Shift+click starts a fresh range instead of stretching from a stale row.
*/
export function prunePatchDetachSelection({ items, selection }: {
  items: readonly PatchDetachSelectable[];
  selection: PatchDetachSelection;
}): PatchDetachSelection {
  const selectable = new Set(items.filter((item) => item.selectable).map((item) => item.key));
  const selected = [...selection.selected].filter((key) => selectable.has(key));
  const anchor = selection.anchor != null && selectable.has(selection.anchor) ? selection.anchor : undefined;
  const unchanged = anchor === selection.anchor && selected.length === selection.selected.size;
  if (unchanged) return selection;
  return withSelection(new Set(selected), anchor);
}

/** What a click on the permanent-delete button covers. */
export type PatchDetachDeleteScope = 'selection' | 'all';

export interface PatchDetachDeletePlan {
  /** `selection`: the selected sources; `all`: the sources "nothing selected" offers. */
  readonly scope: PatchDetachDeleteScope;
  /** The source paths this delete would unlink, in visual order. Empty means "nothing to delete". */
  readonly paths: string[];
  /** How many of `paths` are deletable only because the user allowed their reason in the settings. */
  readonly extraCount: number;
}

/**
What the permanent-delete button would remove right now.

A delete only ever unlinks sources of `detached_src_media` that are deletable, whatever is selected.
With nothing selected at all the button is not dead: it offers the whole list of sources that are
ready for deletion - but the sources the user only allowed in the deletion settings (the extra
kinds) are left out unless `includeExtraInAll` also allows them. A selection always covers whatever
the user picked, extra kinds included. A selection that holds only results, or only sources that may
not be deleted, still counts as a selection: it keeps the delete disabled instead of silently
widening it to every source.
*/
export function planPatchDetachDelete({ items, selected, includeExtraInAll = false }: {
  items: readonly PatchDetachSelectable[];
  /** The item keys that are selected (sources and results alike). */
  selected: ReadonlySet<string>;
  /** With nothing selected, also offer the sources that are deletable only by the extra setting. */
  includeExtraInAll?: boolean;
}): PatchDetachDeletePlan {
  const deletableSources = items.filter((item) => item.kind === 'source' && item.deletable);
  const selectedSources = deletableSources.filter((item) => selected.has(item.key));
  const plan = (scope: PatchDetachDeleteScope, sources: readonly PatchDetachSelectable[]): PatchDetachDeletePlan => ({
    scope,
    paths: sources.map((item) => item.path),
    extraCount: sources.filter((item) => item.extraDeletable === true).length,
  });
  if (selectedSources.length > 0) return plan('selection', selectedSources);
  const allSources = includeExtraInAll ? deletableSources : deletableSources.filter((item) => item.extraDeletable !== true);
  if (selected.size === 0 && allSources.length > 0) return plan('all', allSources);
  return plan('selection', []);
}

/** How many items of one column are selected (the header shows it, the delete button counts sources). */
export function countPatchDetachSelection({ items, selection, kind }: {
  items: readonly PatchDetachSelectable[];
  selection: PatchDetachSelection;
  kind: PatchDetachGridItemKind;
}): number {
  let count = 0;
  for (const item of items) {
    if (item.kind === kind && item.selectable && selection.selected.has(item.key)) count += 1;
  }
  return count;
}
