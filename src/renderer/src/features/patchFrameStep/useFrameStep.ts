import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { isSameFrameTime, planFrameStep } from '../../../../common/features/patchTransport/frameStep';
import type { ChromiumHTMLVideoElement } from '../../types';

/**
Patch-mode single-frame stepping (fork-owned).

mpv's frame step is "pause, move one frame, stay paused" (`player/video.c`), and its backward
step is an exact seek (`frame-back-step` = `frame-step -1 seek`). Patch mode does the same, except
that it puts the previous playback state back once the seek has landed: stepping while playing
must not be a sticky pause.

The key part is *when* playback comes back. Resuming right after issuing the seek is what used to
fight the playhead, and the upstream `smoothSeek` path makes it worse: it coalesces seeks and
re-applies them on `seeked`, so an intermediate `seeked` arrives before the final target. This
slice therefore pauses first, seeks through the app's own `seekAbs` (so its seek bookkeeping and
the commanded time stay consistent), and only resumes on the `seeked` that actually reaches the
target - an intermediate one is ignored.

Repeated presses chain from the pending target, so a quick `D D D` moves three frames even while
the browser is still seeking; the wheel's frame seek goes through the same entry point, and only
its last landing resumes playback.
*/

export interface UseFrameStepOptions {
  enabled: boolean;
  videoRef: RefObject<ChromiumHTMLVideoElement | null>;
  /** Detected FPS; the step falls back to 30 when it is unknown, like upstream. */
  fps: number | undefined;
  /** Live playhead: the video time while playing, the last commanded time while paused. */
  getRelevantTime: () => number;
  /** Upstream's commanded position, so the timeline follows the step and the next one chains. */
  setCommandedTime: (time: number) => void;
  /** Upstream's exact seek entry point (clamps to the file and updates the commanded time). */
  seekAbs: (time: number) => void;
  filePath: string | undefined;
}

/** A seek that never reports `seeked` (the browser snapped back) must not block forever. */
const settleTimeoutMs = 1000;

export function useFrameStep({ enabled, videoRef, fps, getRelevantTime, setCommandedTime, seekAbs, filePath }: UseFrameStepOptions) {
  const optionsRef = useRef({ enabled, fps, getRelevantTime, setCommandedTime, seekAbs });
  useEffect(() => {
    optionsRef.current = { enabled, fps, getRelevantTime, setCommandedTime, seekAbs };
  });

  /** Target of the step whose seek has not landed yet; quick repeats chain from it. */
  const pendingTargetRef = useRef<number | undefined>(undefined);
  /** Put playback back once the step lands, because the step paused a playing video. */
  const resumeRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current != null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = undefined;
    }
  }, []);

  const settleStep = useCallback((landedTime: number) => {
    const shouldResume = resumeRef.current;
    pendingTargetRef.current = undefined;
    resumeRef.current = false;
    clearSettleTimer();

    // Anchor the next step to where the browser really landed: a snapped seek must not make the
    // steps drift away from the picture.
    optionsRef.current.setCommandedTime(landedTime);

    const video = videoRef.current;
    // `paused` is checked because the user may have pressed play during the seek: their choice
    // wins over the resume the step had planned. `ended` is checked so a forward step onto the
    // very end does not restart playback from the beginning.
    if (shouldResume && video != null && video.paused && !video.ended) {
      video.play().catch((err: unknown) => {
        console.error('Failed to resume playback after a frame step', err);
      });
    }
  }, [clearSettleTimer, videoRef]);

  // A different file invalidates the anchor and the pending resume.
  useEffect(() => {
    pendingTargetRef.current = undefined;
    resumeRef.current = false;
    clearSettleTimer();
  }, [clearSettleTimer, filePath]);

  useEffect(() => () => {
    clearSettleTimer();
  }, [clearSettleTimer]);

  useEffect(() => {
    if (!enabled) return undefined;
    const video = videoRef.current;
    if (video == null) return undefined;

    const handleSeeked = () => {
      const pending = pendingTargetRef.current;
      if (pending == null) return;
      // Only the seek that reaches the target settles the step. An intermediate `seeked` (the
      // smooth-seek re-apply, or a seek the browser finished on its way) must not resume
      // playback before the step is where it belongs.
      if (!isSameFrameTime(video.currentTime, pending, optionsRef.current.fps)) return;
      settleStep(video.currentTime);
    };

    video.addEventListener('seeked', handleSeeked);
    return () => {
      video.removeEventListener('seeked', handleSeeked);
    };
  }, [enabled, filePath, settleStep, videoRef]);

  /** Returns false in base mode, so the caller runs its own (upstream) step instead. */
  const stepFrame = useCallback((direction: number) => {
    const { current } = optionsRef;
    if (!current.enabled) return false;

    const video = videoRef.current;
    if (video == null) return false;

    const before = video.currentTime;
    // Ask the element, not `playingRef`: the ref is a mirror, and over a released player it can
    // still say "playing" while there is nothing to play - resuming would then call `play()` on an
    // element without a source and fail (the stale-ref hazard `resolvePlayKeyIntent` fixes for the
    // play key). `paused` is already false right after `play()` is called, and `ended` keeps the
    // resume off a forward step onto the very end.
    const wasPlaying = !video.paused && !video.ended;
    const anchor = pendingTargetRef.current ?? current.getRelevantTime();
    const { time } = planFrameStep({ anchor, direction, fps: current.fps, duration: video.duration });

    pendingTargetRef.current = time;
    resumeRef.current = wasPlaying;

    // Pause before seeking: a seek on a playing video races the playhead, which is what made a
    // backward step get "pulled forward" again by playback.
    if (wasPlaying) video.pause();

    // Through `seekAbs`, so upstream's seek bookkeeping and the commanded time follow the step.
    // The settle below waits for the seek that lands on the target.
    current.seekAbs(time);

    clearSettleTimer();
    if (Math.abs(before - time) < 1e-9) {
      // Nothing moved (stepping back at the very start): no `seeked` will come, so settle now.
      settleStep(time);
    } else {
      settleTimerRef.current = setTimeout(() => {
        settleStep(video.currentTime);
      }, settleTimeoutMs);
    }

    return true;
  }, [clearSettleTimer, settleStep, videoRef]);

  return stepFrame;
}

export default useFrameStep;
