/**
Where a file of the deletion check sits on disk (fork-owned).

One vocabulary for the grid items and the check player's sidebar: a file is either a source waiting
for deletion, a source that was already finished, or one of the four result folders. Both slices
import the type from here so neither has to depend on the other (the player is the shared one).
*/
export type PatchDetachOrigin =
  /** `detached_src_media`: a source waiting for deletion. */
  | 'detachedSrc'
  /** `finished_src_media`: a source whose finish job moved it away. */
  | 'finishedSrc'
  /** `finished_src_media/finished_skip_src`: a source the user skipped. */
  | 'finishedSkip'
  /** `finished_clips`: kept cut results. */
  | 'finishedClips'
  /** `finished_merged`: kept merged results. */
  | 'finishedMerged'
  /** `detached_clips`: cut results waiting for their own deletion. */
  | 'detachedClips'
  /** `detached_merged`: merged results waiting for their own deletion. */
  | 'detachedMerged';
