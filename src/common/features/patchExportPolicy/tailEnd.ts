/**
The tail of the *last* cut result (fork-owned, pure).

A lossless cut stops on a packet boundary, so the requested end is exclusive: the frame that
starts exactly at the end time is not written. At the end of the source that is visible as "the
last picture is missing", and on AV1/HEVC sources the join repair is not available to encode the
tail (see `policy.ts`). The last result is special: no clip follows it, so it can keep the frame
at its end, or the rest of the source, without overlapping another clip.

Two modes:
- `end`: the last result is the last segment of the timeline *and* its cut end is the end the user
  can reach in the player, so it is extended to the source's real last frame. It may be several
  seconds past the requested end when the source's container duration is longer than the player's
  duration (AV1 in Chromium does this).
- `frame`: the last result is a cut in the middle of the source (including a timeline-last segment
  that deliberately stops before the video's end). Only one more frame is kept, so the frame the
  user stopped on is included and nothing after it.

The timeline position alone is *not* enough: a project's last segment often stops before the
source end (credits, an ending that was cut another time). Extending it would swallow the rest of
the file, so the cut end has to be the player's end as well.
*/

import compareStrings from '../patchExport/stringOrder.js';

/** How the last result reaches its end. Stored in the export manifest as part of the clip's identity. */
export type PatchTailMode = 'end' | 'frame';

export interface PatchTailEndPlan {
  mode: PatchTailMode;
  /**
  The effective cut end the cutter must use.

  For `end` it is past the source's last frame, so a stream copy writes the whole tail. For
  `frame` it is the requested end plus one frame.
  */
  cutTo: number;
}

export interface PatchTailTarget extends PatchTailEndPlan {
  /** The segment the plan belongs to (the last one of the export). */
  segId: string;
}

/** The frame duration assumed when the source frame rate is unknown (same fallback as the cutter). */
const fallbackFrameDuration = 1 / 30;

/** A finite, positive frame duration, or the fallback. */
function getSafeFrameDuration(frameDuration: number) {
  return Number.isFinite(frameDuration) && frameDuration > 0 ? frameDuration : fallbackFrameDuration;
}

/** The largest finite value in the list, or the fallback when there is none. */
function maxFinite(fallback: number, ...values: (number | undefined)[]) {
  let max = fallback;
  for (const value of values) {
    if (value != null && Number.isFinite(value)) max = Math.max(max, value);
  }
  return max;
}

/**
The end of the video the user could reach in the player.

The player duration is what the user sees and can seek to; the source's container duration is only
a fallback for when the player has not reported one. `undefined` means neither is known.
*/
function getPlayerEnd(fileDuration: number | undefined, sourceEnd: number | undefined) {
  if (fileDuration != null && Number.isFinite(fileDuration) && fileDuration > 0) return fileDuration;
  if (sourceEnd != null && Number.isFinite(sourceEnd) && sourceEnd > 0) return sourceEnd;
  return undefined;
}

/**
The tail plan of the last result.

`isTimelineLast` is decided by the caller from the project's segments: the last result has to be
the segment with the largest end. When a later segment exists but was not selected, the result is
a mid-source cut and must not swallow the rest of the file.
*/
export function planPatchTailEnd({ requestedEnd, fileDuration, frameDuration, sourceEnd, isTimelineLast }: {
  /** The end of the last segment of this export (the cut point the user set). */
  requestedEnd: number;
  /** The duration the player reports (it may be shorter than the source, see the header). */
  fileDuration: number | undefined;
  /** One frame at the current rate (`getFrameDuration`); a fallback is used when invalid. */
  frameDuration: number;
  /** The source's container duration (`getDuration`), when it could be read. */
  sourceEnd: number | undefined;
  /** Is this segment the last one of the project's timeline? (see `getPatchTailTargets`) */
  isTimelineLast: boolean;
}): PatchTailEndPlan {
  const frame = getSafeFrameDuration(frameDuration);
  // Reaching the source end is an intent, not a position: only a cut at the player's end means "keep
  // the rest of the source". A segment that stops earlier is deliberate (the source may continue
  // with an ending that is cut separately), so it must keep its cut point. One frame of tolerance
  // absorbs the rounding of a playhead that was put on the end.
  const playerEnd = getPlayerEnd(fileDuration, sourceEnd);
  const reachesEnd = playerEnd != null && requestedEnd >= playerEnd - frame;

  if (isTimelineLast && reachesEnd) {
    // Past the source's end by one frame: a stream copy then writes every remaining packet, and the
    // join repair encodes its tail up to the same point. `-t` is not used for a past-the-end cut.
    return { mode: 'end', cutTo: maxFinite(requestedEnd, sourceEnd, fileDuration) + frame };
  }

  // Mid-source cut: include the frame that starts at the requested end, and nothing more.
  const cutTo = requestedEnd + frame;
  return {
    mode: 'frame',
    cutTo: sourceEnd != null && Number.isFinite(sourceEnd) ? Math.min(cutTo, sourceEnd + frame) : cutTo,
  };
}

/**
The tail targets of an export, in no particular order.

Two independent decisions (see `planPatchTailEnd` for the cut ends):

- `end` belongs to the *time-last* segment (the largest end) when it also reaches the end of the
  source. Time is not the queue order, so reordering the queue never moves this target: a segment
  that reached the source end keeps that extension wherever it sits in the export order.
- `frame` belongs to the *queue-last* segment, so the result that ends the merge keeps the frame at
  its cut end. It is skipped when that segment already got `end`, which also keeps that frame.

`allSegments` is the whole project (not just the selection), so a later unselected segment keeps a
selected time-last one a mid-source cut. A time-last segment that stops before the player's end is a
mid-source cut too: `end` is reserved for "the rest of the source".
*/
export function getPatchTailTargets({ segments, allSegments, fileDuration, frameDuration, sourceEnd }: {
  /** The selected segments in export order. */
  segments: readonly { segId: string, end: number }[];
  /** Every real segment of the project (markers and the initial segment excluded). */
  allSegments: readonly { end?: number | undefined }[];
  fileDuration: number | undefined;
  frameDuration: number;
  sourceEnd: number | undefined;
}): PatchTailTarget[] {
  if (segments.length === 0) return [];

  const maxEnd = allSegments.reduce((max, segment) => (
    segment.end != null && Number.isFinite(segment.end) ? Math.max(max, segment.end) : max
  ), 0);

  // The time-last segment, found by end rather than by queue position. Equal ends are broken by
  // segId so a reorder cannot swap the target.
  const timeLast = segments.reduce((best, segment) => (
    segment.end > best.end || (segment.end === best.end && compareStrings(segment.segId, best.segId) < 0)
      ? segment
      : best
  ));
  const isTimelineLast = timeLast.end >= maxEnd - 1e-9;

  const targets: PatchTailTarget[] = [];
  const timeLastPlan = planPatchTailEnd({ requestedEnd: timeLast.end, fileDuration, frameDuration, sourceEnd, isTimelineLast });
  if (timeLastPlan.mode === 'end') {
    targets.push({ segId: timeLast.segId, ...timeLastPlan });
  }

  const queueLast = segments.at(-1)!;
  if (targets.every((target) => target.segId !== queueLast.segId)) {
    targets.push({
      segId: queueLast.segId,
      ...planPatchTailEnd({ requestedEnd: queueLast.end, fileDuration, frameDuration, sourceEnd, isTimelineLast: false }),
    });
  }

  return targets;
}
