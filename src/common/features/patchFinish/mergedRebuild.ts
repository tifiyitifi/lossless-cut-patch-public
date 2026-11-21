/**
Can the merged result be rebuilt from the cut results still in the work area? (fork-owned, pure)

The cut-only finish offers to delete the merged result (moving it to `finished_merged` is the
default) because the cut results it was made from are kept below - the merge can simply be run again.
That is only true while those results are there: a
merge with `clips: 'delete'` leaves the merged file as the only copy of its material, and a later
cut-only job would then offer to delete that copy while pointing at results that do not contain it.

The merged record names the segments it was built from (`mergedSegIds`, read from the chapters at
merge time), so the dialog can tell the two cases apart. A merge recorded before the chapters were
kept has no segment list: the dialog then claims nothing (`true`).
*/
export function isMergedRebuildableFromClips({ mergedSegIds, clips }: {
  /** The segments the merged result was built from (`undefined` when the record does not name them). */
  mergedSegIds: readonly string[] | undefined;
  /** The cut results that are still there. */
  clips: readonly { segId?: string | undefined }[];
}): boolean {
  if (mergedSegIds == null || mergedSegIds.length === 0) return true;
  const present = new Set(clips.flatMap((clip) => (clip.segId == null ? [] : [clip.segId])));
  return mergedSegIds.every((segId) => present.has(segId));
}
