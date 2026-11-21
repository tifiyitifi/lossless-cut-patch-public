// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { detectTimePairsName, parsePairTime, parseTimePairs } from './parseTimePairs.js';
import { formatTimePairDocument, formatTimePairs } from './formatTimePairs.js';

const handWritten = `000130 000132
000250 001023 剧情A
001130\t\t001222`;

/** Shortcut for the common case: the seconds of a token, or a readable failure. */
function secondsOf(raw: string) {
  const parsed = parsePairTime(raw);
  return 'seconds' in parsed ? parsed.seconds : parsed;
}

describe('parsePairTime', () => {
  it('reads the legacy shapes exactly like the src text reader', () => {
    expect(secondsOf('000130')).toBe(90);
    expect(secondsOf('001023456')).toBe(623.456);
    expect(secondsOf('01:02:03')).toBe(3723);
    expect(secondsOf('01:02:03.456')).toBe(3723.456);
    expect(secondsOf('01：02：03')).toBe(3723);
  });

  it('reads the wider written shapes', () => {
    // Short fields and the two-field `M:S` form.
    expect(secondsOf('1:2:3')).toBe(3723);
    expect(secondsOf('1:30')).toBe(90);
    // A comma decimal, as written by hand and by Excel in some locales.
    expect(secondsOf('01:02:03,456')).toBe(3723.456);
    // Plain seconds, with an explicit fraction.
    expect(secondsOf('90.5')).toBe(90.5);
    expect(secondsOf('90,5')).toBe(90.5);
    expect(secondsOf('00:00:00.123456789')).toBe(0.123456789);
  });

  it('refuses a bare short number instead of guessing', () => {
    expect(parsePairTime('130')).toStrictEqual({ error: 'short' });
    expect(parsePairTime('0130')).toStrictEqual({ error: 'short' });
  });

  it('names the field that cannot be a time', () => {
    // `012366` is the legacy positional shape: 01:23:66, and there is no second 66.
    expect(parsePairTime('012366')).toStrictEqual({ error: 'range', field: 'seconds', value: 66 });
    expect(parsePairTime('019900')).toStrictEqual({ error: 'range', field: 'minutes', value: 99 });
    expect(parsePairTime('12:60')).toStrictEqual({ error: 'range', field: 'seconds', value: 60 });
    expect(parsePairTime('1:99')).toStrictEqual({ error: 'range', field: 'seconds', value: 99 });
    expect(parsePairTime('01:99:00')).toStrictEqual({ error: 'range', field: 'minutes', value: 99 });
    expect(parsePairTime('012366000')).toStrictEqual({ error: 'range', field: 'seconds', value: 66 });
  });

  it('rejects what is not a time', () => {
    expect(parsePairTime('nope')).toStrictEqual({ error: 'unparsed' });
    expect(parsePairTime('1234567890')).toStrictEqual({ error: 'unparsed' });
    expect(parsePairTime('')).toStrictEqual({ error: 'unparsed' });
  });
});

describe('parseTimePairs', () => {
  it('reads a hand-written note', () => {
    expect(parseTimePairs(handWritten, { firstLineIsName: false })).toStrictEqual({
      mediaName: undefined,
      rows: [
        { start: 90, end: 92, label: undefined },
        { start: 170, end: 623, label: '剧情A' },
        { start: 690, end: 742, label: undefined },
      ],
      errors: [],
    });
  });

  it('tolerates blank lines, tabs, runs of spaces and full-width spaces', () => {
    const text = [
      '',
      '000130   000132',
      '',
      '\t000250\t\t001023\t剧情A\t',
      '\u3000001130\u3000\u3000001222\u3000',
      '',
    ].join('\n');

    expect(parseTimePairs(text, { firstLineIsName: false })).toStrictEqual({
      mediaName: undefined,
      rows: [
        { start: 90, end: 92, label: undefined },
        { start: 170, end: 623, label: '剧情A' },
        { start: 690, end: 742, label: undefined },
      ],
      errors: [],
    });
  });

  it('reads a text with a name line and a blank line after it', () => {
    const parsed = parseTimePairs(`a.mp4\n\n${handWritten}`, { firstLineIsName: true });
    expect(parsed.mediaName).toBe('a.mp4');
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.errors).toStrictEqual([]);
  });

  it('reads a legacy src text wrapper', () => {
    const parsed = parseTimePairs([
      '<',
      '',
      '"working"',
      ':a.mp4',
      '000130 000132',
      '',
      '000250 001023',
      '>',
    ].join('\n'), { firstLineIsName: false });

    expect(parsed.mediaName).toBe('a.mp4');
    expect(parsed.rows).toStrictEqual([
      { start: 90, end: 92, label: undefined },
      { start: 170, end: 623, label: undefined },
    ]);
    expect(parsed.errors).toStrictEqual([]);
  });

  it('keeps the written order instead of sorting', () => {
    const parsed = parseTimePairs('001130 001222\n000130 000132', { firstLineIsName: false });
    expect(parsed.rows.map((row) => row.start)).toStrictEqual([690, 90]);
  });

  it('reads the separator spellings', () => {
    const parsed = parseTimePairs([
      '000130-000132',
      '000130 → 000132 lab',
      '000130 to 000132',
      '000130 - 000132',
      '000130,000132,lab',
    ].join('\n'), { firstLineIsName: false });

    expect(parsed.errors).toStrictEqual([]);
    expect(parsed.rows).toStrictEqual([
      { start: 90, end: 92, label: undefined },
      { start: 90, end: 92, label: 'lab' },
      { start: 90, end: 92, label: undefined },
      { start: 90, end: 92, label: undefined },
      { start: 90, end: 92, label: 'lab' },
    ]);
  });

  it('keeps dashes inside a label', () => {
    const parsed = parseTimePairs('001130 001222 take-2', { firstLineIsName: false });
    expect(parsed.rows).toStrictEqual([{ start: 690, end: 742, label: 'take-2' }]);
  });

  it('does not split a decimal comma into two times', () => {
    const parsed = parseTimePairs('00:00:01,500 00:00:05', { firstLineIsName: false });
    expect(parsed.rows).toStrictEqual([{ start: 1.5, end: 5, label: undefined }]);
  });

  it('ignores comments and blank lines', () => {
    const parsed = parseTimePairs([
      '# my notes',
      '// another style',
      '',
      '| legacy comment',
      '000130 000132',
    ].join('\n'), { firstLineIsName: false });

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.errors).toStrictEqual([]);
  });

  it('reports the line and the reason instead of dropping the rest', () => {
    const parsed = parseTimePairs([
      '000130 000132',
      '130 000132',
      '000130',
      '000132 000130',
      '000130 nada',
      '012366 012400',
      ':a.mp4',
      ':b.mp4',
    ].join('\n'), { firstLineIsName: false });

    expect(parsed.rows).toStrictEqual([{ start: 90, end: 92, label: undefined }]);
    expect(parsed.errors).toStrictEqual([
      { lineNumber: 2, code: 'shortTime', token: '130' },
      { lineNumber: 3, code: 'missingEnd', token: '000130' },
      { lineNumber: 4, code: 'endNotAfterStart', token: '000130' },
      { lineNumber: 5, code: 'invalidTime', token: 'nada' },
      { lineNumber: 6, code: 'timeRange', token: '012366', field: 'seconds', value: 66 },
      { lineNumber: 1, code: 'multipleVideos', token: 'a.mp4, b.mp4' },
    ]);
  });

  it('reports a label that is too long', () => {
    const parsed = parseTimePairs('000130 000132 一个很长的标签', { firstLineIsName: false, maxLabelLength: 3 });
    expect(parsed.errors).toStrictEqual([{ lineNumber: 1, code: 'labelTooLong', token: '一个很长的标签' }]);
  });

  it('is empty for empty text', () => {
    expect(parseTimePairs('', { firstLineIsName: false })).toStrictEqual({ mediaName: undefined, rows: [], errors: [] });
  });

  it('round trips the outgoing text', () => {
    const parsed = parseTimePairs(handWritten, { firstLineIsName: false });
    const text = formatTimePairs(parsed.rows, { includeLabels: true });
    expect(parseTimePairs(text, { firstLineIsName: false })).toStrictEqual({
      mediaName: undefined,
      rows: parsed.rows,
      errors: [],
    });
  });

  it('round trips the document shape with the name line', () => {
    const parsed = parseTimePairs(handWritten, { firstLineIsName: false });
    const text = formatTimePairDocument({ rows: parsed.rows, includeLabels: true, mediaFileName: 'a.mp4' });
    const [nameLine, blankLine] = text.split('\n', 2);
    expect(nameLine).toBe('a.mp4');
    expect(blankLine).toBe('');
    expect(parseTimePairs(text, { firstLineIsName: true })).toStrictEqual({
      mediaName: 'a.mp4',
      rows: parsed.rows,
      errors: [],
    });
  });

  it('reads a quoted name line instead of treating every quoted line as the legacy marker', () => {
    // Windows' "Copy as path" writes the name in quotes, and a name may hold spaces.
    const text = [String.raw`"C:\work\inbox\a.mp4"`, '000130 000132', '000250 001023'].join('\n');

    expect(parseTimePairs(text, { firstLineIsName: false })).toStrictEqual({
      mediaName: String.raw`C:\work\inbox\a.mp4`,
      rows: [
        { start: 90, end: 92, label: undefined },
        { start: 170, end: 623, label: undefined },
      ],
      errors: [],
    });
    expect(parseTimePairs(text, { firstLineIsName: true }).rows).toHaveLength(2);
  });

  it('keeps the first cut when a quoted name line is ticked as the name', () => {
    // The regression: the quoted line was swallowed, so the first *time pair* became the name.
    const parsed = parseTimePairs('"my video.mp4"\n000130 000132\n000250 001023', { firstLineIsName: true });
    expect(parsed.mediaName).toBe('my video.mp4');
    expect(parsed.rows).toStrictEqual([
      { start: 90, end: 92, label: undefined },
      { start: 170, end: 623, label: undefined },
    ]);
  });

  it('still ignores the legacy folder marker', () => {
    const parsed = parseTimePairs(['"working"', '000130 000132'].join('\n'), { firstLineIsName: false });
    expect(parsed.mediaName).toBeUndefined();
    expect(parsed.rows).toStrictEqual([{ start: 90, end: 92, label: undefined }]);
  });
});

describe('detectTimePairsName', () => {
  it('finds a bare first line that cannot be a time pair', () => {
    expect(detectTimePairsName('我的视频.mp4\n000130 000132')).toBe('我的视频.mp4');
  });

  it('finds a quoted name, with or without spaces', () => {
    expect(detectTimePairsName('"a.mp4"\n000130 000132')).toBe('a.mp4');
    expect(detectTimePairsName('"my video.mp4"\n000130 000132')).toBe('my video.mp4');
    expect(detectTimePairsName('"C:\\work\\inbox\\a.mp4"\n000130 000132')).toBe(String.raw`C:\work\inbox\a.mp4`);
  });

  it('does not read the legacy folder marker as a name', () => {
    expect(detectTimePairsName('"working"\n000130 000132')).toBeUndefined();
  });

  it('finds the legacy file marker', () => {
    expect(detectTimePairsName('<\n"working"\n:a.mp4\n000130 000132\n>')).toBe('a.mp4');
  });

  it('is undefined when the text starts with times', () => {
    expect(detectTimePairsName('000130 000132')).toBeUndefined();
    expect(detectTimePairsName('000130-000132')).toBeUndefined();
    expect(detectTimePairsName('00:01:30 00:01:32')).toBeUndefined();
  });

  it('does not take a mistyped time as a name', () => {
    expect(detectTimePairsName('130 000132')).toBeUndefined();
  });
});
