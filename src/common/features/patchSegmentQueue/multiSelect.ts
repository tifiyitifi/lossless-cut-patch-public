/**
Patch-mode segment multi-selection (pure logic).

The queue keeps two independent selections, and they must never be confused:

- `segment.selected` is the **export** selection (upstream): it decides which segments are cut.
  It is not touched here.
- The **multi-selection** is a temporary set of rows the user is about to act on: Shift+click
  ranges, a count, and the batch buttons under the list ("delete these", "mark these", "keep only
  these"). It is memory only, it never takes part in an export, and it disappears with the file.

Range semantics are the desktop convention the sibling app uses (Iris `_rangeXor` /
`processRangeXorSelection`): the first Shift+click on a row *starts* the selection with that row
and remembers it as the anchor; every further Shift+click toggles the rows between the anchor and
the clicked row (the anchor itself stays as it was, the clicked row becomes the new anchor). That
way several Shift+clicks in a row extend, shrink or reopen a block without the user having to clear
first.

One deliberate deviation from Iris: Shift+clicking the anchor row again *toggles that row off*
instead of doing nothing - otherwise there is no gesture to take a single row back out of the
selection.
*/

/** One row of the list, as the multi-selection sees it. */
export interface MultiSelectRow {
  segId: string;
  start: number;
  /** `undefined` for a marker; a marker has no duration. */
  end?: number | undefined;
}

/** The temporary multi-selection: the rows and the anchor Shift+click ranges start from. */
export interface MultiSelection {
  /** Row the next Shift+click range starts from. */
  anchorSegId?: string | undefined;
  selectedIds: ReadonlySet<string>;
}

export const emptyMultiSelection: MultiSelection = { anchorSegId: undefined, selectedIds: new Set() };

/** What the batch buttons under the list can do with the multi-selection. */
export type MultiSelectActionKind = 'delete' | 'select' | 'deselect' | 'only';

/**
What a Shift+click does.

`rows` is the list as the user sees it (the queue order). The result is the new multi-selection;
the caller only stores it, it never touches `segment.selected`.
*/
export function applyRangeXor({ rows, selection, targetSegId }: {
  rows: readonly MultiSelectRow[];
  selection: MultiSelection;
  targetSegId: string;
}): MultiSelection {
  const targetIndex = rows.findIndex((row) => row.segId === targetSegId);
  // A row that is not in the list any more (a stale click, a re-render race) changes nothing.
  if (targetIndex === -1) return selection;

  const anchorIndex = selection.anchorSegId == null ? -1 : rows.findIndex((row) => row.segId === selection.anchorSegId);

  // No anchor yet, or an anchor that is gone (the list changed under the selection): there is no
  // block to sweep, so this click only toggles the clicked row and becomes the new anchor. A caret
  // that is still where it was toggles that one row the same way.
  if (anchorIndex === -1 || anchorIndex === targetIndex) {
    const selectedIds = new Set(selection.selectedIds);
    if (selectedIds.has(targetSegId)) selectedIds.delete(targetSegId);
    else selectedIds.add(targetSegId);
    return { anchorSegId: targetSegId, selectedIds };
  }

  const selectedIds = new Set(selection.selectedIds);
  const from = Math.min(anchorIndex, targetIndex);
  const to = Math.max(anchorIndex, targetIndex);
  for (let index = from; index <= to; index += 1) {
    // The anchor keeps the state it already had, exactly like Iris: the gesture XORs the rows the
    // user swept over, and the row it started from is not one of them.
    if (index === anchorIndex) continue;
    const row = rows[index];
    if (row == null) continue;
    if (selectedIds.has(row.segId)) selectedIds.delete(row.segId);
    else selectedIds.add(row.segId);
  }

  return { anchorSegId: targetSegId, selectedIds };
}

/**
Drop every selected row the list no longer has.

The list can change under the selection (undo/redo, a split, a detection run, another file). An id
that is gone can never be acted on again, and keeping it would make the count and the buttons act
on rows the user cannot see. The anchor goes with it, so the next Shift+click starts a new range.
*/
export function pruneMultiSelection({ rows, selection }: {
  rows: readonly MultiSelectRow[];
  selection: MultiSelection;
}): MultiSelection {
  if (selection.selectedIds.size === 0 && selection.anchorSegId == null) return selection;

  const existing = new Set(rows.map((row) => row.segId));
  const selectedIds = new Set([...selection.selectedIds].filter((segId) => existing.has(segId)));
  const anchorSegId = selection.anchorSegId != null && existing.has(selection.anchorSegId) ? selection.anchorSegId : undefined;

  if (selectedIds.size === selection.selectedIds.size && anchorSegId === selection.anchorSegId) return selection;
  return { anchorSegId, selectedIds };
}

/** The rows the multi-selection holds, in list order, plus what the action bar shows. */
export function summarizeMultiSelection({ rows, selection }: {
  rows: readonly MultiSelectRow[];
  selection: MultiSelection;
}) {
  const selected = rows.filter((row) => selection.selectedIds.has(row.segId));
  // A marker has no end time, so it can never be exported. "Keep only these" must not count it,
  // or a marker-only selection would deselect every real segment (upstream then exports them all).
  const exportable = selected.filter((row): row is MultiSelectRow & { end: number } => row.end != null);
  const duration = exportable.reduce((total, row) => total + Math.max(0, row.end - row.start), 0);
  return {
    selectedIds: selected.map((row) => row.segId),
    exportableIds: exportable.map((row) => row.segId),
    count: selected.length,
    exportableCount: exportable.length,
    duration,
  };
}

/** What the action bar would do, or `undefined` when the button must be a no-op. */
export type MultiSelectPlan =
  | { kind: 'none' }
  | { kind: 'remove', segIds: string[] }
  | { kind: 'selection', mode: 'select' | 'deselect' | 'only', segIds: string[] };

/**
Turn one action of the bar into the change the list has to make.

An empty multi-selection does nothing: the buttons are disabled, and a stale click (the list
emptied between render and press) must not delete or mark everything.
*/
export function planMultiSelectAction({ action, rows, selection }: {
  action: MultiSelectActionKind;
  rows: readonly MultiSelectRow[];
  selection: MultiSelection;
}): MultiSelectPlan {
  const { selectedIds, exportableIds } = summarizeMultiSelection({ rows, selection });
  if (selectedIds.length === 0) return { kind: 'none' };

  if (action === 'delete') return { kind: 'remove', segIds: selectedIds };
  // "Keep only these" deselects every other segment; a marker can only ever be kept in the list,
  // never exported. With nothing exportable it would deselect them all, and the export then falls
  // back to *every* segment: the opposite of what the button says.
  if (action === 'only') {
    if (exportableIds.length === 0) return { kind: 'none' };
    return { kind: 'selection', mode: 'only', segIds: exportableIds };
  }
  return { kind: 'selection', mode: action, segIds: selectedIds };
}

/**
Does the export really use every segment although the list says otherwise?

Upstream falls back to "all segments" when no segment with an end time is selected, so "mark as not
exported" on the whole list leaves the export unchanged. The bar says so instead of pretending the
list is empty (markers never count: they are not exported either way).
*/
export function isExportSelectionEmpty(segments: readonly { end?: number | undefined, selected?: boolean | undefined }[]) {
  const exportable = segments.filter((segment) => segment.end != null);
  return exportable.length > 0 && exportable.every((segment) => segment.selected !== true);
}
