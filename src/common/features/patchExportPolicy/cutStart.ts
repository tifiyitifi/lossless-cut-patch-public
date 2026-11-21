/**
Where a repaired clip can start copying (fork-owned, pure).

A repaired clip copies from the first keyframe at or after its cut start (see `policy.ts`). A segment
that begins after the source's last keyframe has no such keyframe: upstream then throws "Cannot find
any keyframe after the desired start cut point" and the export stops with no result at all. That
segment lies inside one GOP, so a copy would have to begin before the cut point anyway - the whole
segment is encoded instead (measured on a 2 s segment at the end of a source whose last keyframe
came 0.6 s before it).
*/

/**
Is there a keyframe the copy can start on?

`keyframeTimes` are the source's keyframe timestamps around the cut start, in order; `cutFrom` is the
segment's start. A keyframe exactly on the cut start counts: the copy starts there with no head.
*/
export function hasKeyframeToCopyFrom({ keyframeTimes, cutFrom }: {
  keyframeTimes: readonly number[];
  cutFrom: number;
}) {
  return keyframeTimes.some((time) => time >= cutFrom);
}
