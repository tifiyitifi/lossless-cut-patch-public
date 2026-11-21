/**
Patch-mode frame stepping (fork-owned, pure).

mpv steps a frame by pausing first and then seeking (see `player/command.c`'s
`frame-back-step`, which is `frame-step -1 seek`, and `player/video.c`, which pauses when the
step is done). The HTML player has no per-frame callback to count frames with, so the seek
mode is the only reliable one for both directions: the step is "pause, seek to the next frame
boundary, then put the playback state back".

This module only answers *where* the step goes. The renderer slice
(`features/patchFrameStep`) owns the pause / seek / resume around it.
*/

/**
Upstream falls back to 30 fps when the FPS is unknown (e.g. an audio-only file), and patch mode
keeps that: a frame key must do something even before the metadata is fully known.
*/
export const fallbackFrameStepFps = 30;

export function resolveFrameStepFps(fps: number | undefined): number {
  return fps != null && Number.isFinite(fps) && fps > 0 ? fps : fallbackFrameStepFps;
}

export interface FrameStepPlan {
  /** The frame number the step lands on. */
  frame: number;
  /** The time to seek to, clamped to the file's duration. */
  time: number;
}

const TIME_EPSILON = 1e-9;

/**
Where one frame step lands.

- The anchor is rounded to a frame number first: the playhead sits between frames while playing,
  and a step must move exactly one frame from the frame the picture shows.
- The target never goes below 0, and never past the duration (the last step lands on the end).
- `direction` is -1 (back) or 1 (forward); 0 keeps the position.
- The frame number is derived from the clamped time, so the two always agree.

A variable-frame-rate file can only be stepped exactly towards -1 (the same limitation mpv
documents for the seek mode): forward, `1 / fps` is the average frame duration, not the next
frame's. Both directions still move one *nominal* frame, which is what a cut point needs.
*/
export function planFrameStep({ anchor, direction, fps, duration }: {
  anchor: number;
  direction: number;
  fps: number | undefined;
  duration: number | undefined;
}): FrameStepPlan {
  const safeFps = resolveFrameStepFps(fps);
  let step = 0;
  if (direction < 0) step = -1;
  else if (direction > 0) step = 1;
  const anchorTime = Number.isFinite(anchor) ? Math.max(anchor, 0) : 0;
  const anchorFrame = Math.round(anchorTime * safeFps);
  const frame = Math.max(anchorFrame + step, 0);

  let time = frame / safeFps;
  if (duration != null && Number.isFinite(duration) && duration >= 0 && time > duration) time = duration;

  return { frame: Math.round(time * safeFps), time };
}

/** Whether two positions are the same frame boundary (used to tell "already there" from a seek). */
export function isSameFrameTime(a: number, b: number, fps: number | undefined): boolean {
  const safeFps = resolveFrameStepFps(fps);
  return Math.abs(a - b) <= TIME_EPSILON + 0.5 / safeFps;
}
