/**
The `start` / `end` time representation of the `.llc` project file.

The project file stores segment times. Upstream LosslessCut writes them as plain numbers of
seconds, which are exact but hard to read. This module adds an opt-in readable representation
(`HH:MM:SS.nnnnnnnnn`, fixed width so times stay sortable and easy to diff) while keeping the
numeric one around for compatibility.

The representation decides the project file version (see `getLlcProjectVersion`): the numeric
one stays v2, so upstream (and older builds) can still open the file; the readable one needs v3.

Pure logic only (no DOM / Electron / Node APIs), so it can run in any process and be tested.
*/

/** How the `.llc` project file stores `start` / `end`. */
export type LlcTimeFormat = 'seconds' | 'timecode';

/** The project file version a time format is written with. */
export function getLlcProjectVersion(format: LlcTimeFormat): 2 | 3 {
  return format === 'timecode' ? 3 : 2;
}

const nanosecondDigits = 9;
const nanosecondsPerSecond = 1e9;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
Format seconds as `HH:MM:SS.nnnnnnnnn`.

Fixed 9 fraction digits (nanoseconds): that is far below FFmpeg's microsecond precision, so the
stored value is practically lossless, and a fixed width keeps the file easy to read and diff.
Hours are not capped, so long media does not wrap around.
*/
export function formatLlcTime(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  // Rounds to the nearest nanosecond. Note that this quantizes the (double) second value: the error
  // is at most half a nanosecond, and re-saving the parsed value is stable.
  const totalNanoseconds = Math.round(Math.abs(totalSeconds) * nanosecondsPerSecond);
  const nanoseconds = totalNanoseconds % nanosecondsPerSecond;
  const totalSecondsInt = Math.floor(totalNanoseconds / nanosecondsPerSecond);
  const seconds = totalSecondsInt % 60;
  const totalMinutes = Math.floor(totalSecondsInt / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  return `${sign}${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${String(nanoseconds).padStart(nanosecondDigits, '0')}`;
}

const timecodeRegex = /^(-)?(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/;
const plainNumberRegex = /^-?\d+(?:\.\d+)?$/;

/**
Parse a stored time value back into seconds.

Lenient on purpose: besides the canonical `HH:MM:SS.nnnnnnnnn`, it accepts a shorter fraction
(`HH:MM:SS.fff`), short field widths (`H:M:S`) and plain numbers of seconds (a file hand edited,
or written by another tool).
*/
export function parseLlcTime(value: string | number): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  const match = timecodeRegex.exec(trimmed);
  if (match != null) {
    const [, sign, hoursStr, minutesStr, secondsStr, fractionStr] = match;
    const hours = Number(hoursStr);
    const minutes = Number(minutesStr);
    const seconds = Number(secondsStr);
    if (minutes > 59 || seconds > 59) return undefined;
    const fraction = fractionStr != null ? Number(`0.${fractionStr}`) : 0;
    const total = (hours * 3600) + (minutes * 60) + seconds + fraction;
    return sign === '-' ? -total : total;
  }

  if (plainNumberRegex.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds : undefined;
  }

  return undefined;
}

/** Parse an unknown stored time value (from JSON) into seconds, or `undefined` when unusable. */
export function normalizeLlcTimeValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return parseLlcTime(value);
  return undefined;
}
