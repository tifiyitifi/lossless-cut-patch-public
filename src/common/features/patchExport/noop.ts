import type { PatchExportPlan, PatchMergedPlan } from './plan.js';

/**
Would this export write nothing at all? (fork-owned)

The incremental export reuses every result whose file on disk already has the right content and
the right name. When nothing changed since the last export, pressing the export key therefore
writes no file and runs no FFmpeg - and if the export-finished notice is silenced too, the key
looks dead. The caller asks instead of pretending to work (see `App.onExportConfirm`).

`reuse` is the only decision that keeps everything as it is: `rename` moves a file, `export`
cuts, `blocked` keeps a *differently named* previous result (a warning follows), and `skipped`
writes nothing while the wanted name belongs to a file the app does not own (that is a problem
to report, never a "nothing to do"). The same goes for the merged result: `blocked` keeps the
previous merged file, so nothing is written either.
*/
// eslint-disable-next-line import/prefer-default-export -- the slice index re-exports the named helper
export function isNoOpExport({ clips, merged, orderChanged = false }: {
  clips: PatchExportPlan | undefined;
  merged: PatchMergedPlan | undefined;
  /**
  Did the cut queue order change since the last export? (fork-owned)

  Then the export still has work to do: the manifest has to record the new order, or the next merge
  would join the clips in the old one. No file is written, but the key must not look dead.
  */
  orderChanged?: boolean | undefined;
}): boolean {
  // A changed queue order is work even though it writes no file: the order is what the merge follows.
  if (orderChanged) return false;
  // Neither plan exists: this is not the incremental path (no work area, chapters mode), so the
  // export is not ours to call a no-op.
  if (clips == null && merged == null) return false;
  if (clips != null && clips.decisions.some((decision) => !(decision.kind === 'reuse'))) return false;
  if (merged != null && merged.action !== 'reuse' && merged.action !== 'blocked') return false;
  return true;
}
