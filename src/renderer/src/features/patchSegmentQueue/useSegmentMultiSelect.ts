import { useCallback, useEffect, useMemo, useState } from 'react';

import { applyRangeXor, emptyMultiSelection, planMultiSelectAction, pruneMultiSelection, summarizeMultiSelection } from '../../../../common/features/patchSegmentQueue';
import type { MultiSelectActionKind, MultiSelectRow, MultiSelection } from '../../../../common/features/patchSegmentQueue';

/**
The cut queue's Shift+click multi-selection (fork-owned).

It is a *temporary* selection, separate from the export selection (`segment.selected`, the circle
on the row): sweeping rows with Shift+click collects them, and the buttons under the list then act
on exactly those rows - delete them, mark them as exported or not exported, or keep only them. Until
one of those buttons is pressed nothing about the export changes, so a mis-click can always be
reverted by clicking again or pressing Escape.

Entry: Shift+click a row. The first click starts the selection with that row; every further
Shift+click toggles the block between the previous row and the clicked one (see
`common/features/patchSegmentQueue/multiSelect`). A plain click on a row keeps its upstream meaning
(it makes the row current) and leaves the mode. Escape leaves the mode as well - but only when no
dialog or input owns the key, so the shortcut cannot steal Escape from a dialog.

The set is pruned whenever the list changes (undo/redo, a split, a deletion, another file): an id
that is gone can no longer be acted on, and the bar must never offer to delete rows that are not
there. Nothing here is remembered between files or sessions.
*/

export interface SegmentMultiSelectOptions {
  /** Only the cutting window's queue has this mode (not the results or merged windows, not invert mode). */
  enabled: boolean;
  segments: readonly (MultiSelectRow & { selected?: boolean | undefined, initial?: boolean | undefined })[];
  /** Remove these segment ids (one history step, locked while this window exports). */
  removeSegments: (segIds: string[]) => void;
  /** Mark exactly these segment ids as exported / not exported / the only exported ones. */
  applySegmentsSelection: (segIds: string[], mode: 'select' | 'deselect' | 'only') => void;
  /** Is the list locked right now (an export is running)? Then the bar only reports. */
  locked: boolean;
  /** The source is read-only (work area / finished folder): the rows may be marked, not deleted. */
  readOnly?: boolean | undefined;
}

export default function useSegmentMultiSelect({ enabled, segments, removeSegments, applySegmentsSelection, locked, readOnly = false }: SegmentMultiSelectOptions) {
  const [storedSelection, setSelection] = useState<MultiSelection>(emptyMultiSelection);

  const rows = useMemo<MultiSelectRow[]>(
    () => segments.map(({ segId, start, end }) => ({ segId, start, end })),
    [segments],
  );

  // The list can change under the selection: ids and the anchor that are gone are dropped during
  // render (undo/redo, a split, a deletion, another file), so the bar never offers to act on a row
  // that is not there. The pruned value is stable, and the caller's stored set is left as it was.
  const pruned = useMemo(
    () => pruneMultiSelection({ rows, selection: storedSelection }),
    [rows, storedSelection],
  );
  // Outside the cutting window's queue the mode does not exist at all.
  const selection = enabled ? pruned : emptyMultiSelection;

  const summary = useMemo(() => summarizeMultiSelection({ rows, selection }), [rows, selection]);
  const open = summary.count > 0;

  const close = useCallback(() => setSelection(emptyMultiSelection), []);

  /**
  Hand a row click to the multi-selection.

  Returns true when the click belongs to the selection, so the caller must not run its own
  "make this row current" behaviour. A plain click therefore keeps the upstream behaviour and only
  leaves the mode.
  */
  const handleRowClick = useCallback((segId: string, shiftKey: boolean) => {
    if (!enabled) return false;

    if (!shiftKey) {
      // Upstream wins a plain click: it selects the row as current. The mode just steps aside.
      setSelection((existing) => (existing.selectedIds.size === 0 ? existing : emptyMultiSelection));
      return false;
    }

    setSelection((existing) => applyRangeXor({
      rows,
      selection: pruneMultiSelection({ rows, selection: existing }),
      targetSegId: segId,
    }));
    return true;
  }, [enabled, rows]);

  const runAction = useCallback((action: MultiSelectActionKind) => {
    if (locked) return;
    // A finished source only decides what an export *would* use; its segments stay where they are.
    if (action === 'delete' && readOnly) return;
    const plan = planMultiSelectAction({ action, rows, selection });
    if (plan.kind === 'remove') {
      removeSegments(plan.segIds);
      // The rows are gone, so the selection has nothing left to hold: nothing to prune to.
      setSelection(emptyMultiSelection);
      return;
    }
    if (plan.kind === 'selection') {
      applySegmentsSelection(plan.segIds, plan.mode);
      // The mode stays open: "mark these, then delete them" is the usual next step.
    }
  }, [applySegmentsSelection, locked, readOnly, removeSegments, rows, selection]);

  // Escape leaves the mode. It must not take Escape away from a dialog, the command console, an
  // input or a SweetAlert: those own the key while they are open (same rule as hooks/useKeyboard).
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || e.repeat || e.isComposing) return;
      const { target } = e;
      if (target instanceof HTMLElement) {
        if (target.closest('[role="dialog"], [role="alertdialog"]') != null) return;
        const { tagName } = target;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable) return;
      }
      if (document.querySelector('.swal2-container') != null) return;

      e.preventDefault();
      e.stopPropagation();
      close();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [close, open]);

  return {
    enabled,
    open,
    selection,
    summary,
    handleRowClick,
    runAction,
    close,
  };
}
