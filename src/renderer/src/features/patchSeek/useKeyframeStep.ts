import { useCallback, useEffect, useRef } from 'react';

import type { KeyframeCoverage, KeyframeStepDirection } from '../../../../common/features/patchSeek';
import { keyframePrefetchKey, mergeKeyframeTimes, resolveKeyframeStep, shouldReadKeyframes } from '../../../../common/features/patchSeek';
import { readFrames } from '../../ffmpeg';
import isDev from '../../isDev';

/**
Patch-mode keyframe stepping (fork-owned).

Wraps `resolveKeyframeStep` (pure logic in `common/features/patchSeek`) with the three things it
cannot do on its own:
- remember the previous target, so repeated presses keep moving while the video plays;
- read keyframe packets when the upstream cache (a window around `commandedTime`) does not cover
  the next step, so a hold never dead-ends at the edge of the window;
- prefetch the window ahead of a step, so most holds do not wait for ffprobe at all.
*/

export interface UseKeyframeStepOptions {
  enabled: boolean;
  /** Keyframe times the upstream `useKeyframes` cache currently knows about. */
  keyframeTimes: () => readonly number[];
  /** The live playhead (the video time while playing, the commanded time while paused). */
  liveTime: () => number;
  /** Upstream's last commanded position. */
  commandedTime: number;
  /** One frame in seconds (`1 / detectedFps`, or 0.1 when the FPS is unknown). */
  sigma: number;
  filePath: string | undefined;
  streamIndex: number | undefined;
  /** Keyframe read window in seconds (`ffmpegExtractWindow`). */
  window: number;
  seekAbs: (time: number) => void;
}

interface LatestOptions {
  enabled: boolean;
  keyframeTimes: () => readonly number[];
  liveTime: () => number;
  sigma: number;
  window: number;
  seekAbs: (time: number) => void;
}

const EDGE_EPSILON = 1e-6;

/**
How often a step extends its read before it gives up.

The reads double their window each time (`1x`, `2x`, `4x`, ...), so a file with an unusually long
GOP (or a range the upstream cache never read) is still crossed in a few reads instead of the step
jumping over the hole.
*/
const KEYFRAME_PROOF_ATTEMPTS = 6;

export function useKeyframeStep({ enabled, keyframeTimes, liveTime, commandedTime, sigma, filePath, streamIndex, window, seekAbs }: UseKeyframeStepOptions) {
  const extraKeyframeTimesRef = useRef<readonly number[]>([]);
  const lastTargetRef = useRef<number | undefined>(undefined);
  const inFlightRef = useRef<{ key: string, promise: Promise<void> } | undefined>(undefined);
  const fetchTokenRef = useRef(0);
  const prefetchedWindowsRef = useRef<Set<string>>(new Set());
  const filePathRef = useRef(filePath);
  const streamIndexRef = useRef(streamIndex);
  const commandedTimeRef = useRef(commandedTime);
  /** The ranges this file's keyframes were read from, merged (see `shouldReadKeyframes`). */
  const coverageRef = useRef<KeyframeCoverage[]>([]);
  /**
  Where a step already stopped, so holding the key stops reading.

  A read that found nothing in one direction is the start/end of the file; a candidate the reads
  could not prove is a range nobody could read. Both answers are stable while the base and the
  candidate stay the same, so the auto-repeat does not spawn ffprobe again and again.
  */
  const edgeRef = useRef<{ direction: KeyframeStepDirection, base: number, target: number | undefined } | undefined>(undefined);
  const optionsRef = useRef<LatestOptions>({ enabled, keyframeTimes, liveTime, sigma, window, seekAbs });

  useEffect(() => {
    optionsRef.current = { enabled, keyframeTimes, liveTime, sigma, window, seekAbs };
    filePathRef.current = filePath;
    streamIndexRef.current = streamIndex;
    commandedTimeRef.current = commandedTime;
  });

  // A different file/stream invalidates every cached target and window.
  useEffect(() => {
    extraKeyframeTimesRef.current = [];
    coverageRef.current = [];
    lastTargetRef.current = undefined;
    inFlightRef.current = undefined;
    fetchTokenRef.current += 1;
    prefetchedWindowsRef.current = new Set();
    edgeRef.current = undefined;
  }, [filePath, streamIndex]);

  const applyTarget = useCallback((target: number | undefined) => {
    if (target == null) return false;
    lastTargetRef.current = target;
    // The next press may arrive before the next render. The anchor check compares the commanded
    // time with the last target, so it has to see the position we just seeked to; otherwise a fast
    // repeat is treated as "somebody else seeked" and the step loses its anchor.
    commandedTimeRef.current = target;
    optionsRef.current.seekAbs(target);
    edgeRef.current = undefined;
    return true;
  }, []);

  /**
  Remember that a range was read completely.

  Ranges that touch are merged, so a long session does not accumulate thousands of intervals - and
  a merged range stays valid: the keyframes between two touching reads were all read.
  */
  const recordCoverage = useCallback((from: number, to: number) => {
    const merged: KeyframeCoverage[] = [];
    for (const interval of [...coverageRef.current, { from, to }].sort((a, b) => a.from - b.from)) {
      const last = merged.at(-1);
      if (last != null && interval.from <= last.to + EDGE_EPSILON) last.to = Math.max(last.to, interval.to);
      else merged.push({ from: interval.from, to: interval.to });
    }
    coverageRef.current = merged;
  }, []);

  const fetchWindow = useCallback((center: number, direction: KeyframeStepDirection, scale = 1) => {
    // Deduplicate by direction as well: a read behind the playhead must not be served by the read
    // ahead of it that happens to be in flight.
    const readWindow = Math.max(optionsRef.current.window, 1) * Math.max(scale, 1);
    const safeCenter = Math.max(center, 0);
    // The same key the prefetch uses: a read is only reused for the very same range. A read that
    // starts a fraction of a second later would leave the first keyframes of the requested range
    // unread, and the step would jump over them.
    const key = keyframePrefetchKey({ direction, center: safeCenter, window: readWindow });
    if (inFlightRef.current?.key === key) return inFlightRef.current.promise;

    const startFilePath = filePathRef.current;
    const startStreamIndex = streamIndexRef.current;
    if (startFilePath == null || startStreamIndex == null) return Promise.resolve();

    // Read *behind* (or ahead of) the step rather than centering the window: a GOP can be longer
    // than half the window, and the keyframe we need is only ever on one side.
    const from = direction < 0 ? Math.max(safeCenter - readWindow - 1, 0) : safeCenter;
    const to = direction < 0 ? safeCenter : safeCenter + readWindow + 1;
    if (to - from <= 1e-3) return Promise.resolve();

    fetchTokenRef.current += 1;
    const token = fetchTokenRef.current;
    const promise = (async () => {
      try {
        const frames = await readFrames({ filePath: startFilePath, streamIndex: startStreamIndex, from, to });
        if (filePathRef.current !== startFilePath || streamIndexRef.current !== startStreamIndex) return;
        // The range is known now, even when it holds no keyframe at all: that is what tells a long
        // GOP apart from a range nobody read.
        recordCoverage(Math.min(from, to), Math.max(from, to));
        const times = frames.filter((frame) => frame.keyframe).map((frame) => frame.time);
        if (times.length === 0) return;
        extraKeyframeTimesRef.current = mergeKeyframeTimes(extraKeyframeTimesRef.current, times);
      } catch (err) {
        console.error('Failed to read keyframes around', center, err);
      } finally {
        if (fetchTokenRef.current === token) inFlightRef.current = undefined;
      }
    })();

    inFlightRef.current = { key, promise };
    return promise;
  }, [recordCoverage]);

  const prefetchWindow = useCallback((center: number, times: readonly number[], target: number, direction: KeyframeStepDirection) => {
    if (inFlightRef.current != null) return;

    // Only when the target is the last known keyframe in this direction: that is when the next
    // press would otherwise need to read packets.
    const isEdge = times.every((time) => (direction < 0 ? time >= target - EDGE_EPSILON : time <= target + EDGE_EPSILON));
    if (!isEdge) return;

    const readWindow = Math.max(optionsRef.current.window, 1);
    // The direction belongs to the key: the prefetch reads the window in one direction only, so a
    // window that was prefetched ahead does not serve the step backwards.
    const key = keyframePrefetchKey({ direction, center, window: readWindow });
    if (prefetchedWindowsRef.current.has(key)) return;
    prefetchedWindowsRef.current.add(key);
    fetchWindow(center, direction).catch((err) => console.error('Failed to prefetch keyframes', err));
  }, [fetchWindow]);

  const stepKeyframe = useCallback(async (direction: KeyframeStepDirection) => {
    if (!optionsRef.current.enabled) {
      if (isDev) console.debug('Keyframe step ignored: patch stepping is off');
      return;
    }

    const getTimes = () => [...optionsRef.current.keyframeTimes(), ...extraKeyframeTimesRef.current];
    const resolveWith = (timesForStep: readonly number[]) => resolveKeyframeStep({
      keyframeTimes: timesForStep,
      direction,
      liveTime: optionsRef.current.liveTime(),
      commandedTime: commandedTimeRef.current,
      lastTarget: lastTargetRef.current,
      sigma: optionsRef.current.sigma,
    });

    const times = getTimes();
    const first = resolveWith(times);

    // The last read already found no way to step from this place (start/end of the file, or a range
    // that could not be read): holding the key must not spawn ffprobe again and again.
    const previousEdge = edgeRef.current;
    if (previousEdge?.direction === direction && Math.abs(first.base - previousEdge.base) <= EDGE_EPSILON && first.target === previousEdge.target) return;

    const cachedTarget = first.target;
    if (cachedTarget != null && !shouldReadKeyframes({ result: first, coverage: coverageRef.current })) {
      applyTarget(cachedTarget);
      prefetchWindow(cachedTarget, times, cachedTarget, direction);
      return;
    }

    const startFilePath = filePathRef.current;
    const startStreamIndex = streamIndexRef.current;
    if (startFilePath == null || startStreamIndex == null) {
      if (isDev) console.debug('Keyframe step has no file/stream to read from yet', direction);
      return;
    }

    // Read (and extend the read) until the range between the base and the target is known. A target
    // across a hole nobody read is not the next keyframe - the log of a real step showed 25s -> 250s
    // because the times of an earlier read at the end of the file were merged in.
    let resolved = first;
    for (let attempt = 0; attempt < KEYFRAME_PROOF_ATTEMPTS; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fetchWindow(first.base, direction, 2 ** attempt);
      if (filePathRef.current !== startFilePath || streamIndexRef.current !== startStreamIndex) return;
      resolved = resolveWith(getTimes());
      if (!shouldReadKeyframes({ result: resolved, coverage: coverageRef.current })) break;
    }

    if (resolved.target == null || shouldReadKeyframes({ result: resolved, coverage: coverageRef.current })) {
      // Nothing in this direction, or the range still could not be read: stop here instead of
      // seeking over keyframes nobody looked at.
      if (isDev) console.debug('Keyframe step found no proven target', direction, resolved.base, resolved.target);
      edgeRef.current = { direction, base: resolved.base, target: resolved.target };
      return;
    }

    applyTarget(resolved.target);
    prefetchWindow(resolved.target, getTimes(), resolved.target, direction);
  }, [applyTarget, fetchWindow, prefetchWindow]);

  return { stepKeyframe };
}
