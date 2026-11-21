/**
Patch-mode "preview the end of the current segment" (Shift+Right).

Jumping straight to the end of a segment makes the last few seconds impossible to review, so the
key stops a lead-in before the end. Pressing it again once the playhead is already inside that
last stretch goes to the end instead (so two presses still reach the end).

The target is clamped to the segment start: for a segment shorter than the lead-in there is no
room for a tail preview, so a playhead that is already at/after the start goes to the end.
*/
export default function getSegmentEndPreviewTime({ start, end, currentTime, leadInSeconds }: {
  start: number,
  end: number,
  currentTime: number,
  leadInSeconds: number,
}) {
  // A segment whose end is not after its start (corrupt data) has no tail: jumping to its end would
  // move the playhead backwards, so stay where it is.
  if (!(end > start)) return currentTime;
  const leadIn = Number.isFinite(leadInSeconds) ? Math.max(0, leadInSeconds) : 0;
  const target = Math.max(start, end - leadIn);
  return currentTime >= target ? end : target;
}

/** A stretch of the timeline the tail preview can jump into. */
export interface SegmentEndPreviewRange {
  start: number;
  end: number;
}

/**
Which stretch the tail preview jumps into.

- `segment`: the cutting window. The cut segments live in the source video, so the key previews
  the end of the selected segment.
- `timeline`: the results windows. They play one clip (a cut result), so the key previews the end
  of that clip. Their cut list is a throw-away one, so it must not be used here.
*/
export type SegmentEndPreviewScope = 'segment' | 'timeline';

/**
The stretch the tail preview jumps into, or `undefined` when there is nothing to preview.

A segment without an end (a marker, or a segment that is still being cut) has no tail, so the key
does nothing there - the same as before.
*/
export function resolveSegmentEndPreviewRange({ scope, segments, selectedIndex, timeline }: {
  scope: SegmentEndPreviewScope,
  segments: readonly { start: number, end?: number | undefined }[],
  selectedIndex: number,
  timeline?: SegmentEndPreviewRange | undefined,
}): SegmentEndPreviewRange | undefined {
  if (scope === 'timeline') return timeline != null && timeline.end > timeline.start ? timeline : undefined;
  const segment = segments[selectedIndex];
  if (segment?.end == null) return undefined;
  // A reversed segment has no tail to preview (the merge/export would fail on it anyway).
  return segment.end > segment.start ? { start: segment.start, end: segment.end } : undefined;
}
