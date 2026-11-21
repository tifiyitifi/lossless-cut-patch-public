/**
Where the join repair stops copying and starts encoding (fork-owned, pure).

A repaired clip is three parts: an encoded head, a copied middle and an encoded tail. The middle
may not be empty, so the tail can only be encoded when a keyframe *after* the head keyframe exists
before the cut end: the copy then ends one frame before that keyframe and the tail encode covers
the rest.

When the cut end still falls inside the head GOP there is nothing to copy between the two: the
clip has to be encoded as a whole. Keeping the copy there would leave the clip ending on a packet
boundary, which drops the trailing B frames - exactly the hole the repair exists to remove (see
`policy.ts`). Short clips are the common case here, not an edge case: a cut that starts mid-GOP
and ends within the next GOP is shorter than two GOPs.
*/

/** What to do with the part of the clip after the head. */
export type JoinRepairTailPlan =
  /** No keyframe to start a tail encode from: keep the plain lossless copy. */
  | { kind: 'copy-only' }
  /** Copy up to `copyTo`, then encode the last GOP. */
  | { kind: 'copy-middle'; copyTo: number }
  /** Encode the segment from the cut start to the cut end: there is no middle to copy. */
  | { kind: 'encode-whole' };

/**
The tail plan of one repaired clip.

`tailKeyframe` is the last keyframe at or before `cutEnd`; `headKeyframe` is the first keyframe at
or after the cut start (the one the head encode starts from).
*/
export function planJoinRepairTail({ tailKeyframe, headKeyframe, frameDuration }: {
  /** `undefined` when no keyframe could be located before the cut end. */
  tailKeyframe: number | undefined;
  headKeyframe: number;
  frameDuration: number;
}): JoinRepairTailPlan {
  if (tailKeyframe == null) return { kind: 'copy-only' };

  // One frame of middle is the minimum: `copyTo` must stay past the head encode, or the copy part
  // would be empty (and `-t 0` writes nothing).
  if (tailKeyframe > headKeyframe + frameDuration) {
    return { kind: 'copy-middle', copyTo: tailKeyframe - frameDuration };
  }

  // The tail keyframe *is* the head keyframe (or one frame past it): the cut end is inside the head
  // GOP. A copy would end on a packet boundary and keep the trailing hole, so encode the whole
  // segment. The price is one more GOP than a repaired long clip; the alternative is the stutter.
  return { kind: 'encode-whole' };
}
