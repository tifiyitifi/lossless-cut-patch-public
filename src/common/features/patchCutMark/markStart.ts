/**
"The next in point starts a new segment" (patch-mode pure logic, fork-owned).

Patch mode arms the rule with `Alt+/`: the *next* in point adds a segment instead of moving the
start of the current one, and the arm is used up by that press. `O` / `Down` and every other key
leave it armed.

The decision itself lives here so it is unit-tested, and so the base-mode path stays exactly the
upstream one: base mode never arms, and an unarmed press runs the upstream rule unchanged.
*/

export interface CutStartMarkState {
  /** `Alt+/` was pressed: this in point must add a segment. */
  forced: boolean;
  /** The current segment (the one the in point would move), or `undefined` when there is none. */
  currentSegment: { start: number, end?: number | undefined } | undefined;
  /** Where the playhead is (the value the in point would use). */
  relevantTime: number;
}

/**
Does this in point add a segment?

Armed: always. Otherwise the upstream rule: with no segment, or when the playhead is at/after the
current segment's end, a new segment is added; otherwise the current segment's start is moved.
A marker (no end) has no end to pass, so it keeps moving its start.
*/
export function shouldStartNewSegment({ forced, currentSegment, relevantTime }: CutStartMarkState): boolean {
  if (forced || (currentSegment == null)) return true;
  return currentSegment.end != null && relevantTime >= currentSegment.end;
}
