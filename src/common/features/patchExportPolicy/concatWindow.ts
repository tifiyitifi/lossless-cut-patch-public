/**
The `-read_intervals` window used to find a clip's video display end (fork-owned, pure).

`readVideoConcatDuration` (renderer) only reads the first second and the tail of a file - these
files can be several GB - and needs the container duration to place the tail window. Without a
usable duration there is no tail to read, and *asking for one anyway* silently turns the first
seconds of the file into its "end": `windowStart` clamps to 0, the probe reads `0%3`, and the
third second is reported as the last frame. The concat demuxer would then start the next clip
seconds early. Returning `undefined` makes the caller fall back to the container duration.
*/

/** How much of the head is read (it holds the first frame; the tail holds the last one). */
const headWindowSeconds = 1;
/** How much of the tail is read: long enough to contain a frame plus the last few packets. */
const tailWindowSeconds = 3;

/** How far before the container end the tail window starts (a frame or two plus muxer rounding). */
const tailLeadInSeconds = 2;

function formatSeconds(seconds: number) {
  // ffprobe accepts decimals; drop the trailing zeros of `3.0000000001`-style sums.
  return String(Number(seconds.toFixed(6)));
}

/**
The `-read_intervals` value for a file of `containerDuration` seconds, or `undefined` when the
duration cannot be trusted (`undefined`, `NaN`, `0` or negative - ffprobe reports those for a
damaged or unfinalized container).
*/
// eslint-disable-next-line import/prefer-default-export
export function getConcatProbeIntervals(containerDuration: number | undefined): string | undefined {
  if (containerDuration == null || !Number.isFinite(containerDuration) || containerDuration <= 0) return undefined;

  const windowStart = Math.max(containerDuration - tailLeadInSeconds, 0);
  const windowEnd = windowStart + tailWindowSeconds;

  // A short file has no separate tail window: one interval covers both ends.
  if (windowStart <= headWindowSeconds) return `0%${formatSeconds(windowEnd)}`;

  return `0%${formatSeconds(headWindowSeconds)},${formatSeconds(windowStart)}%${formatSeconds(windowEnd)}`;
}
