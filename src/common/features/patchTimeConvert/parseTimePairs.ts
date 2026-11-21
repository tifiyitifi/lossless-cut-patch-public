/**
Time pair text -> cut rows (pure).

Cut points are the easiest thing to write down by hand, and they are how cut lists travel between
people: one line per cut, `start end [label]`. Two shapes have to be read:

- a plain note (`000130 000132`, `000250 001023 剧情A`), optionally with the video name on its own
  first line (`a.mp4`, or `"a.mp4"` as Windows' "Copy as path" writes it);
- a legacy `src_*.txt` from the earlier PowerShell workflow (`cut_and_merge`):

```
<                     <- merge group start (ignored)
"working"             <- folder marker (ignored)
:a.mp4                <- the video the times below belong to
000130 000132
000250 001023
>                     <- merge group end (ignored)
```

`detectTimePairsName` answers whether that first line is a name, so the dialog can offer it as a
ticked checkbox instead of guessing.

Times are the legacy ones (6-9 digits `HHMMSSfff`, `HH:MM:SS[.fff]`, full-width `：`) plus the wider
written forms this app accepts (`H:M:S` with short fields, `M:S`, a comma decimal, plain seconds
with an explicit fraction) - see `parsePairTime`.

Every time is *validated*, including the legacy shapes: the legacy reader rolls an out-of-range
value over (a written `012366` would silently become one extra minute), while a hand-written list
should say that 66 seconds is not a time. That is what `timeRange` carries.

Blank lines, runs of spaces / tabs / full-width spaces, and the legacy comment lines are ignored;
the one thing that is *not* guessed is a bare 1-5 digit number (see `parsePairTime`).

Pure logic only (no DOM / Electron / Node APIs), so the dialog and the tests share it.
*/
import { parseLegacyTime } from '../patchData/timeParse.js';

/** One cut row: both times in seconds and the optional label. */
export interface TimePairRow {
  start: number;
  end: number;
  label: string | undefined;
}

/**
What is wrong with one line. The renderer owns the message for each code (i18n), so the parser stays
free of user-facing copy.
*/
export type TimePairErrorCode = | 'shortTime'
  | 'timeRange'
  | 'invalidTime'
  | 'missingEnd'
  | 'endNotAfterStart'
  | 'labelTooLong'
  | 'multipleVideos';

export interface TimePairParseError {
  /** 1-based line number of the offending line in the pasted text. */
  lineNumber: number;
  code: TimePairErrorCode;
  /** The token the message should point at, when there is one. */
  token: string | undefined;
  /** For `timeRange`: which part of the time is out of range, and what it says. */
  field?: 'minutes' | 'seconds' | undefined;
  value?: number | undefined;
}

export interface ParsedTimePairs {
  /** The video the text names (`:a.mp4`, or the first line), if any. */
  mediaName: string | undefined;
  /** The valid rows, in the order they were written (that order is the cut/merge order). */
  rows: TimePairRow[];
  /** Everything that could not be read. Empty means the whole text converted. */
  errors: TimePairParseError[];
}

export interface ParseTimePairsOptions {
  /** The first meaningful line is the video name, not a time pair. */
  firstLineIsName: boolean;
  /** Label length the cut list accepts (same limit as the label dialog). */
  maxLabelLength?: number | undefined;
}

/** What one written time token says. */
export type PairTime = | { error: 'short' }
  | { error: 'range'; field: 'minutes' | 'seconds'; value: number }
  | { error: 'unparsed' }
  | { seconds: number };

/** Range separators a written range may use between the two times. */
const rangeSeparators = ['→', '~', '-', '–', '—'] as const;

/** Colon times with short fields, `M:S`, a comma decimal and fractions up to nanoseconds. */
const shortColonTimeRegex = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:[.,](\d{1,9}))?$/u;
/** The legacy `HH:MM:SS[.fff]` shape (full-width colons included). */
const legacyColonTimeRegex = /^(\d{2})[:：](\d{2})[:：](\d{2})(?:\.(\d{1,3}))?$/u;
/** The legacy positional shape, `HHMMSS` with up to three fraction digits. */
const positionalTimeRegex = /^\d{6,9}$/u;
/** Plain seconds, but only with an explicit fraction: `90` alone is the ambiguous shape below. */
const secondsTimeRegex = /^\d+[.,]\d{1,9}$/u;
/** 1-5 digits: a hand-written `HMMSS`/`MMSS`, or a typo for the 6-digit legacy time. */
const shortDigitsRegex = /^\d{1,5}$/u;

function isTimeValue(value: PairTime): value is { seconds: number; } {
  return 'seconds' in value;
}

function outOfRange(field: 'minutes' | 'seconds', value: number): PairTime {
  return { error: 'range', field, value };
}

/** `：` and `，` come from Chinese IMEs; the parser reads the half-width forms. */
function normalizeTimeToken(value: string) {
  return value.replaceAll('：', ':').replaceAll('，', ',');
}

/**
Seconds of one time token.

`short` marks a bare 1-5 digit number: it cannot be told apart from a shortened `HHMMSS` (is `130`
a minute and a half, or a mistyped `00:01:30`?), so the caller reports it instead of guessing.
`range` names the field that cannot be a time (`012366` is not 67 minutes 6 seconds - it is a typo).
*/
export function parsePairTime(raw: string): PairTime {
  const token = normalizeTimeToken(raw.trim());
  if (token === '') return { error: 'unparsed' };

  // The legacy positional shape. Validated before the legacy reader sees it, because that reader
  // rolls out-of-range values over instead of refusing them.
  if (positionalTimeRegex.test(token)) {
    const padded = token.padEnd(9, '0');
    const minutes = Number(padded.slice(2, 4));
    const seconds = Number(padded.slice(4, 6));
    if (minutes > 59) return outOfRange('minutes', minutes);
    if (seconds > 59) return outOfRange('seconds', seconds);
    const legacy = parseLegacyTime(token);
    return legacy != null ? { seconds: legacy } : { error: 'unparsed' };
  }

  const legacyColon = legacyColonTimeRegex.exec(token);
  if (legacyColon != null) {
    const minutes = Number(legacyColon[2]);
    const seconds = Number(legacyColon[3]);
    if (minutes > 59) return outOfRange('minutes', minutes);
    if (seconds > 59) return outOfRange('seconds', seconds);
    const fraction = legacyColon[4];
    return {
      seconds: (Number(legacyColon[1]) * 3600) + (minutes * 60) + seconds
        + (fraction != null ? Number(fraction.padEnd(3, '0')) / 1000 : 0),
    };
  }

  // `H:M:S[.fff]` with one-digit fields, `M:S`, a comma decimal and longer fractions.
  const colon = shortColonTimeRegex.exec(token);
  if (colon != null) {
    const [, first, second, third, fraction] = colon;
    const hours = third != null ? Number(first) : 0;
    const minutes = third != null ? Number(second) : Number(first);
    const seconds = third != null ? Number(third) : Number(second);
    if (minutes > 59) return outOfRange('minutes', minutes);
    if (seconds > 59) return outOfRange('seconds', seconds);
    return { seconds: (hours * 3600) + (minutes * 60) + seconds + (fraction != null ? Number(`0.${fraction}`) : 0) };
  }

  if (secondsTimeRegex.test(token)) return { seconds: Number(token.replace(',', '.')) };

  if (shortDigitsRegex.test(token)) return { error: 'short' };

  return { error: 'unparsed' };
}

function isSeparatorToken(token: string) {
  return token.toLowerCase() === 'to' || (rangeSeparators as readonly string[]).includes(token);
}

/**
Split a whole range written as one token (`000130-000132`).

Both sides have to read as times, so a label keeps its own dashes (`001130 001222 take-2`).
*/
function splitRangeToken(token: string): [string, string] | undefined {
  for (const separator of rangeSeparators) {
    const parts = token.split(separator);
    if (parts.length !== 2) continue;
    const [first, second] = parts;
    if (first == null || second == null || first === '' || second === '') continue;
    if (isTimeValue(parsePairTime(first)) && isTimeValue(parsePairTime(second))) return [first, second];
  }
  return undefined;
}

interface RowFailure {
  error: TimePairErrorCode;
  token: string | undefined;
  field?: 'minutes' | 'seconds' | undefined;
  value?: number | undefined;
}

/** One side of a row, or the reason it cannot be read. */
function readRowTime(token: string): RowFailure | { seconds: number; } {
  const parsed = parsePairTime(token);
  if (isTimeValue(parsed)) return parsed;
  if (parsed.error === 'short') return { error: 'shortTime', token };
  if (parsed.error === 'range') return { error: 'timeRange', token, field: parsed.field, value: parsed.value };
  return { error: 'invalidTime', token };
}

function buildRow({ startToken, endToken, labelTokens, maxLabelLength }: {
  startToken: string;
  endToken: string;
  labelTokens: string[];
  maxLabelLength: number | undefined;
}): TimePairRow | RowFailure {
  const start = readRowTime(startToken);
  if (!('seconds' in start)) return start;

  const end = readRowTime(endToken);
  if (!('seconds' in end)) return end;
  if (end.seconds <= start.seconds) return { error: 'endNotAfterStart', token: endToken };

  const label = labelTokens.join(' ').trim();
  if (label !== '' && maxLabelLength != null && label.length > maxLabelLength) {
    return { error: 'labelTooLong', token: label };
  }

  return { start: start.seconds, end: end.seconds, label: label === '' ? undefined : label };
}

/**
Read the fields of one line.

Accepted shapes: `start end [label]`, `start - end [label]`, `start to end [label]` and the range
written as one token (`start-end [label]`). The label is everything after the two times, joined back
together, so a label may contain spaces.
*/
function parseRowFields(fields: string[], maxLabelLength: number | undefined): TimePairRow | RowFailure {
  const [first, second, third] = fields;
  if (first == null) return { error: 'invalidTime', token: undefined };

  // `001130 - 001222 [label]` / `001130 to 001222 [label]`
  if (second != null && isSeparatorToken(second)) {
    if (third == null) return { error: 'missingEnd', token: second };
    return buildRow({ startToken: first, endToken: third, labelTokens: fields.slice(3), maxLabelLength });
  }

  // `001130-001222 [label]`
  const range = splitRangeToken(first);
  if (range != null) {
    return buildRow({ startToken: range[0], endToken: range[1], labelTokens: fields.slice(1), maxLabelLength });
  }

  if (second == null) return { error: 'missingEnd', token: first };
  return buildRow({ startToken: first, endToken: second, labelTokens: fields.slice(2), maxLabelLength });
}

function isRowFailure(value: TimePairRow | RowFailure): value is RowFailure {
  return 'error' in value;
}

/** The content of a line that is one quoted string, or `undefined` when it is not. */
function quotedLineContent(value: string) {
  const match = /^(["'])(.*)\1$/u.exec(value);
  return match == null ? undefined : match[2]!;
}

/**
The legacy wrapper's folder marker (`"working"`), which is not a video name.

It is the only quoted line the cutting script used for something else. Treating *every* quoted line
as that marker silently dropped the video name - and, with the name line ticked, the first cut -
because `"a.mp4"` / `"C:\work\inbox\a.mp4"` is exactly what Windows' "Copy as path" writes.
*/
function isLegacyFolderMarker(value: string) {
  return value.trim().toLowerCase() === 'working';
}

/** Lines the legacy wrapper and hand-written notes use for something other than a time pair. */
function isIgnoredLine(line: string) {
  if (line === '') return true;
  if (line.startsWith('#') || line.startsWith('//')) return true;
  // Legacy merge-group markers.
  if (line.startsWith('<') || line.startsWith('>')) return true;
  // Legacy comment lines (the cutting script ignored lines starting with these). A name that starts
  // with `/` or `\` (a UNC path pasted without quotes) is read as one of these too; quote it.
  if (line.startsWith('/') || line.startsWith('\\') || line.startsWith('|')) return true;
  // The legacy wrapper's folder marker (`"working"`). Any other quoted line is a video name.
  const quoted = quotedLineContent(line);
  return quoted != null && isLegacyFolderMarker(quoted);
}

function unquote(value: string) {
  return quotedLineContent(value) ?? value;
}

/**
The video named by a whole-line quoted string.

Hand-written lists and "Copy as path" put the name in quotes, and it may hold spaces, so it can only
be read as a name - never as a time pair.
*/
function quotedFileNameOfLine(line: string) {
  const content = quotedLineContent(line);
  if (content == null) return undefined;
  const name = content.trim();
  if (name === '' || isLegacyFolderMarker(name)) return undefined;
  return name;
}

/** The video named on a legacy `:a.mp4` line. */
function fileNameOfLine(line: string) {
  if (!line.startsWith(':')) return undefined;
  const name = unquote(line.slice(1).trim());
  return name === '' ? undefined : name;
}

/**
Split a line into fields.

Whitespace is the field separator (that is what the legacy files and hand-written notes use -
spaces, tabs, runs of them, and the full-width space all count). A comma or semicolon is only used
when the line has no two fields otherwise (`000130,000132`), because a comma is also a decimal
separator inside a time (`00:00:01,500`).
*/
function splitFields(line: string) {
  const bySpace = line.split(/\s+/u).filter(Boolean);
  if (bySpace.length >= 2) return bySpace;
  const byPunctuation = line.split(/[,;]+/u).map((part) => part.trim()).filter(Boolean);
  return byPunctuation.length >= 2 ? byPunctuation : bySpace;
}

/** Only digits, colons and dots: a mistyped time, never a video name. */
function looksNumericOnly(value: string) {
  return /^[\d.,:：]+$/u.test(value);
}

/**
The video name when the first meaningful line is one.

A name is either the legacy `:a.mp4` line, a whole-line quoted name (`"a.mp4"`, as "Copy as path"
writes it), or a line that cannot be a time pair at all (`我的视频.mp4`). A line that is only digits or
has the shape of a time is never taken as a name, so a typo is reported instead of silently becoming
the file name.
*/
export function detectTimePairsName(text: string): string | undefined {
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (isIgnoredLine(line)) continue;

    const fileName = fileNameOfLine(line);
    if (fileName != null) return fileName;

    const quotedName = quotedFileNameOfLine(line);
    if (quotedName != null) return quotedName;

    const fields = splitFields(line);
    const firstField = fields[0];
    if (fields.length === 1 && firstField != null && splitRangeToken(firstField) == null && !looksNumericOnly(firstField)) {
      return unquote(line);
    }
    return undefined;
  }
  return undefined;
}

/**
Read a whole text into cut rows.

Rows keep the order they were written in: that order is the cut and merge order, so it is never
re-sorted here. Errors are collected per line instead of failing the conversion, so one typo does
not throw away the other cuts.
*/
export function parseTimePairs(text: string, options: ParseTimePairsOptions): ParsedTimePairs {
  const rows: TimePairRow[] = [];
  const errors: TimePairParseError[] = [];
  const names: string[] = [];
  let firstLineHandled = false;

  text.split(/\r?\n/u).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (isIgnoredLine(line)) return;

    const fileName = fileNameOfLine(line);
    if (fileName != null) {
      names.push(fileName);
      firstLineHandled = true;
      return;
    }

    // A quoted line names the video (`"a.mp4"`, "Copy as path"): it is never a cut. Without this,
    // a ticked name line would take the first *time pair* as the name and drop that cut.
    const quotedName = quotedFileNameOfLine(line);
    if (quotedName != null) {
      names.push(quotedName);
      firstLineHandled = true;
      return;
    }

    if (!firstLineHandled && options.firstLineIsName) {
      names.push(unquote(line));
      firstLineHandled = true;
      return;
    }
    firstLineHandled = true;

    const result = parseRowFields(splitFields(line), options.maxLabelLength);
    if (isRowFailure(result)) {
      errors.push({
        lineNumber,
        code: result.error,
        token: result.token,
        ...(result.field != null && { field: result.field }),
        ...(result.value != null && { value: result.value }),
      });
    } else {
      rows.push(result);
    }
  });

  // One cut list belongs to one video: a text naming two videos has to be split by hand.
  const distinctNames = [...new Set(names)];
  if (distinctNames.length > 1) {
    errors.push({ lineNumber: 1, code: 'multipleVideos', token: distinctNames.join(', ') });
  }

  return { mediaName: distinctNames[0], rows, errors };
}
