import type { TimecodeFormat } from '../../types.js';

/**
The formats the timecode input accepts, as the rows of the help block in the `g` dialog
(fork-owned).

Templates and examples are technical constants, not copy: only `TimecodeHint` ids are looked up
in the renderer, which owns the translations (see `features/timecodeInput/TimecodeHelp.tsx`).
Keeping the rows here makes them testable: an example of the compact group must parse with
`parseCompactTimeInput`.
*/

export type TimecodeHintId = | 'compactFields'
  | 'compactMillis'
  | 'compactPositional'
  | 'compactMinutesSeconds'
  | 'compactColon'
  | 'relative'
  | 'seconds'
  | 'commaDecimal'
  | 'minutesSeconds'
  | 'hoursMinutesSeconds'
  | 'frameCount'
  | 'frameMinutesSeconds'
  | 'frameHoursMinutesSeconds';

export interface TimecodeHint {
  id: TimecodeHintId,
  /** The shape of the input, with `H`/`M`/`S` standing for the values. */
  template: string,
  /** A working example of that shape. */
  example: string,
}

export interface TimecodeHintGroup {
  id: 'compact' | 'mode',
  hints: TimecodeHint[],
}

const compactHints: TimecodeHint[] = [
  { id: 'compactFields', template: '..H.M.S', example: '..1.2.3' },
  { id: 'compactMillis', template: '..H.M.S.fff', example: '..12.34.56.7' },
  { id: 'compactMinutesSeconds', template: '..M.S', example: '..34.56' },
  { id: 'compactPositional', template: '..HHMMSSfff', example: '..123456789' },
  { id: 'compactColon', template: '..H:M:S', example: '..12:34:56' },
];

const relativeHint: TimecodeHint = { id: 'relative', template: '+..H.M.S', example: '+..1.2.3' };

const modeHints: Record<TimecodeFormat, TimecodeHint[]> = {
  timecodeWithDecimalFraction: [
    { id: 'seconds', template: 'S.mmm', example: '123.456' },
    { id: 'commaDecimal', template: 'S,mmm', example: '123,456' },
    { id: 'minutesSeconds', template: 'M:S.mmm', example: '01:30.5' },
    { id: 'hoursMinutesSeconds', template: 'H:M:S.mmm', example: '01:02:03.456' },
  ],
  seconds: [
    { id: 'seconds', template: 'S.mmm', example: '123.456' },
  ],
  frameCount: [
    { id: 'frameCount', template: 'F', example: '1234' },
  ],
  timecodeWithFramesFraction: [
    { id: 'frameMinutesSeconds', template: 'M:S.ff', example: '01:30.15' },
    { id: 'frameHoursMinutesSeconds', template: 'H:M:S.ff', example: '00:01:02.15' },
  ],
};

/**
The rows of the help block: what every timecode format accepts, then what the current format
adds. `showRelative` follows the dialog: only the `g` dialog turns `+`/`-` into a relative seek.
*/
export function getTimecodeHintGroups({ mode, showRelative }: {
  mode: TimecodeFormat,
  showRelative: boolean,
}): TimecodeHintGroup[] {
  return [
    { id: 'compact', hints: showRelative ? [...compactHints, relativeHint] : compactHints },
    { id: 'mode', hints: modeHints[mode] },
  ];
}
