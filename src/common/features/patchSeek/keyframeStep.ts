/**
Patch-mode keyframe stepping (pure logic).

Upstream's `seekClosestKeyframe` is a stateless query: it resolves the nearest keyframe from the
*live* playhead. While the video is playing the playhead keeps moving forward, so pressing
"previous keyframe" again resolves to the keyframe it just landed on and the cursor looks stuck.

Patch mode remembers the target of the previous step and keeps stepping from it (the same idea as
mpv's `last_seek_pts`), until the playhead leaves that keyframe's GOP or another seek happens.
Paused behaviour stays identical to upstream: there the live playhead is stable, so the anchor
resolves to the same keyframe the upstream query would pick.
*/

export type KeyframeStepDirection = -1 | 1;

export interface KeyframeStepInput {
  /** Known keyframe times in seconds. Any order; duplicates are harmless. */
  keyframeTimes: readonly number[];
  direction: KeyframeStepDirection;
  /** Live playhead (the video element time while playing, the commanded time while paused). */
  liveTime: number;
  /** Last commanded position. Steps set it to their target, so it detects any *other* seek. */
  commandedTime: number;
  /** Target of the previous step, or undefined when the previous step did not come from here. */
  lastTarget: number | undefined;
  /** One frame in seconds (1/fps, or 0.1 when the FPS is unknown). */
  sigma: number;
}

export interface KeyframeStepResult {
  /** The keyframe to seek to, or undefined at the start/end of the file. */
  target: number | undefined;
  /** The position the step was resolved from (the previous target, or the live playhead). */
  base: number;
  usedAnchor: boolean;
}

const EPSILON = 1e-6;
const DEFAULT_SIGMA = 0.1;

function findFirstAfter(times: readonly number[], time: number) {
  let best: number | undefined;
  for (const candidate of times) {
    if (candidate > time + EPSILON && (best == null || candidate < best)) best = candidate;
  }
  return best;
}

function findPreviousKeyframe(times: readonly number[], time: number) {
  let best: number | undefined;
  for (const candidate of times) {
    if (candidate <= time + EPSILON && (best == null || candidate > best)) best = candidate;
  }
  return best;
}

function findNextKeyframe(times: readonly number[], time: number) {
  let best: number | undefined;
  for (const candidate of times) {
    if (candidate >= time - EPSILON && (best == null || candidate < best)) best = candidate;
  }
  return best;
}

function isAnchorUsable({ times, liveTime, commandedTime, lastTarget, sigma }: {
  times: readonly number[];
  liveTime: number;
  commandedTime: number;
  lastTarget: number | undefined;
  sigma: number;
}) {
  if (lastTarget == null || !Number.isFinite(lastTarget)) return false;

  // Any seek that did not come from a step (timeline click, cut point jump, pause, file change)
  // moves the commanded time away from the last target. Only then is the anchor stale.
  if (Math.abs(commandedTime - lastTarget) > Math.max(sigma / 2, 1e-3)) return false;

  // Playback may keep moving inside the anchor's GOP - that is the case the anchor exists for.
  // Once the playhead reaches the next keyframe, "previous keyframe from here" is a different
  // one, so let the step re-anchor to the live position.
  const next = findFirstAfter(times, lastTarget);
  return !(next != null && liveTime >= next - EPSILON);
}

export function resolveKeyframeStep({ keyframeTimes, direction, liveTime, commandedTime, lastTarget, sigma }: KeyframeStepInput): KeyframeStepResult {
  const safeLiveTime = Number.isFinite(liveTime) ? liveTime : 0;
  const safeCommandedTime = Number.isFinite(commandedTime) ? commandedTime : safeLiveTime;
  const safeSigma = Number.isFinite(sigma) && sigma > 0 ? sigma : DEFAULT_SIGMA;
  const times = keyframeTimes.filter((time) => Number.isFinite(time));

  const usedAnchor = isAnchorUsable({ times, liveTime: safeLiveTime, commandedTime: safeCommandedTime, lastTarget, sigma: safeSigma });
  const base = usedAnchor && lastTarget != null ? lastTarget : safeLiveTime;
  const limit = base + direction * safeSigma;

  const target = direction < 0 ? findPreviousKeyframe(times, limit) : findNextKeyframe(times, limit);
  return { target, base, usedAnchor };
}

/** Merge keyframe times from several reads into one list (deduplicated, ascending). */
export function mergeKeyframeTimes(...lists: readonly (readonly number[])[]): number[] {
  const times = new Set<number>();
  for (const list of lists) {
    for (const time of list) {
      if (Number.isFinite(time)) times.add(time);
    }
  }
  return [...times].sort((a, b) => a - b);
}

/**
The key of a prefetched keyframe window.

The prefetch reads the window *in one direction* (ahead of or behind the playhead), so the
direction belongs to the key: a window that was prefetched ahead does not serve the step
backwards, and skipping that prefetch would make the other direction wait for a read.

The key identifies the window that was read: the read covers the window that starts at the
playhead, so two different positions need two different reads (the second one would be missing
its tail otherwise, and the step would have to wait for a read again).

The same key identifies a read that is in flight, so a read is only reused for the very same
range. A key that rounded the position would let a read that starts a fraction of a second
later serve a request whose first keyframes it never read, and the step would jump over them.
*/
export function keyframePrefetchKey({ direction, center, window }: {
  direction: KeyframeStepDirection;
  /** The position the prefetch starts from. */
  center: number;
  /** The read window in seconds. */
  window: number;
}) {
  const readWindow = Math.max(window, 1);
  return `${direction}:${Math.max(center, 0)}:${readWindow}`;
}

/**
A range whose keyframes were read completely.

The known times are a union of windows (`extraKeyframeTimesRef` merges reads, the upstream cache
keeps a window around a stale `commandedTime`), so between two known keyframes there can be a range
nobody ever looked at. A step must never cross such a hole: 26 unread keyframes look exactly like
one long GOP.
*/
export interface KeyframeCoverage {
  from: number;
  to: number;
}

/** Does one of the read ranges contain every keyframe between `base` and `target`? */
export function isTargetCovered({ base, target, coverage }: {
  base: number;
  target: number;
  coverage: readonly KeyframeCoverage[];
}) {
  if (!Number.isFinite(base) || !Number.isFinite(target)) return false;
  const low = Math.min(base, target);
  const high = Math.max(base, target);
  return coverage.some((interval) => interval.from <= low + EPSILON && interval.to >= high - EPSILON);
}

/**
Should we read keyframe packets before trusting `result`?

A target is only the *next* keyframe when every keyframe between the base and it was actually seen:
the merged lists are windows, and the gap between two windows is not a short GOP (that is how a
step from 25.0s landed on 250.0s while the keyframes in between had never been read - #1311 jumps
to the edge of a window for the same reason).
*/
export function shouldReadKeyframes({ result, coverage }: {
  result: KeyframeStepResult;
  coverage: readonly KeyframeCoverage[];
}) {
  if (result.target == null) return true;
  return !isTargetCovered({ base: result.base, target: result.target, coverage });
}
