import type { PatchFinishClipRef } from './preview.js';

/**
Split the tracked cut results into the ones this export produced and the older ones (fork-owned).

A finish job works on the whole work area (`listTrackedClips`), but only the results of the last
export belong to the job the user is ending. The rest are "historical" results: inputs a merge left
behind (`clips: keep`), or results cut earlier with the intent to merge them in a later pass. They
may stay in the work area to avoid cutting them again, or be deleted when the video is done - the
finish options decide, see `deleteStaleClips`.

The manifest records the last export's selection as `order` (`PatchExportFileRecord.order`). The
split is deliberately conservative: without a recorded order, or for a result without an identity,
nothing is stale. A file we cannot prove is old is never handed to a delete step.
*/
export interface PatchFinishClipSplit {
  /** The results of the export this job ends (the manifest order), plus results without an identity. */
  selected: PatchFinishClipRef[];
  /** Results that belong to an earlier export / a finished merge. */
  stale: PatchFinishClipRef[];
}

export function splitClipsByExportSelection(
  clips: readonly PatchFinishClipRef[],
  selectedSegIds: readonly string[] | undefined,
): PatchFinishClipSplit {
  if (selectedSegIds == null || selectedSegIds.length === 0) {
    return { selected: [...clips], stale: [] };
  }

  const selectedIds = new Set(selectedSegIds);
  const selected: PatchFinishClipRef[] = [];
  const stale: PatchFinishClipRef[] = [];
  for (const clip of clips) {
    // A result without a segment identity cannot be matched to the order: keep it.
    if (clip.segId == null || selectedIds.has(clip.segId)) selected.push(clip);
    else stale.push(clip);
  }
  return { selected, stale };
}
