/**
Time comparison for the incremental export (pure, fork-owned).

The readable `.llc` format stores times with nanosecond precision (see `patchData/llcTime`), so
a project saved and reopened yields slightly different doubles for a segment that was created
from a full double (e.g. `duration / count`). The difference is far below FFmpeg's microsecond
precision, so it must not make the export cut the result again - or rebuild the merged file.

Times are therefore compared and fingerprinted in whole nanoseconds. The key is also safe for
the map keys in `plan.ts`: two doubles that the project file cannot distinguish get one key.
*/

const nanosecondsPerSecond = 1e9;

/** The second value rounded to the precision the `.llc` timecode format stores. */
export function roundPatchTime(seconds: number) {
  return Math.round(seconds * nanosecondsPerSecond) / nanosecondsPerSecond;
}

/** The second value as whole nanoseconds (the key two stored times are compared with). */
export function patchTimeKey(seconds: number) {
  return Math.round(seconds * nanosecondsPerSecond);
}

/** Do two times name the same stored time? */
export function isSamePatchTime(a: number, b: number) {
  return patchTimeKey(a) === patchTimeKey(b);
}
