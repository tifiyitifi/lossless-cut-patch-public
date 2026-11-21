// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { formatLlcTime, getLlcProjectVersion, normalizeLlcTimeValue, parseLlcTime } from './llcTime.js';

describe('formatLlcTime', () => {
  it('formats seconds as a fixed width readable timecode', () => {
    expect(formatLlcTime(0)).toBe('00:00:00.000000000');
    expect(formatLlcTime(3723)).toBe('01:02:03.000000000');
    expect(formatLlcTime(3723.456)).toBe('01:02:03.456000000');
    expect(formatLlcTime(3723.456789)).toBe('01:02:03.456789000');
  });

  it('keeps nanosecond precision', () => {
    expect(formatLlcTime(0.000000001)).toBe('00:00:00.000000001');
    expect(formatLlcTime(1.999999999)).toBe('00:00:01.999999999');
  });

  it('rounds to the nearest nanosecond', () => {
    expect(formatLlcTime(0.0000000004)).toBe('00:00:00.000000000');
    expect(formatLlcTime(0.0000000006)).toBe('00:00:00.000000001');
  });

  it('does not cap hours at two digits', () => {
    expect(formatLlcTime(360000)).toBe('100:00:00.000000000');
  });

  it('keeps the sign', () => {
    expect(formatLlcTime(-1.5)).toBe('-00:00:01.500000000');
  });

  it('never produces a negative zero', () => {
    expect(formatLlcTime(-0)).toBe('00:00:00.000000000');
  });
});

describe('parseLlcTime', () => {
  it('parses the formatted timecode', () => {
    expect(parseLlcTime('00:00:00.000000000')).toBe(0);
    expect(parseLlcTime('01:02:03.456000000')).toBe(3723.456);
    expect(parseLlcTime('100:00:00.000000000')).toBe(360000);
    expect(parseLlcTime('-00:00:01.500000000')).toBe(-1.5);
  });

  it('accepts shorter fractions and shorter fields (hand edited files)', () => {
    expect(parseLlcTime('01:02:03')).toBe(3723);
    expect(parseLlcTime('01:02:03.4')).toBe(3723.4);
    expect(parseLlcTime('01:02:03.456789')).toBeCloseTo(3723.456789, 9);
    expect(parseLlcTime('1:2:3.5')).toBe(3723.5);
  });

  it('accepts plain numbers (lenient)', () => {
    expect(parseLlcTime(3723.456)).toBe(3723.456);
    expect(parseLlcTime('3723.456')).toBe(3723.456);
  });

  it('returns undefined for invalid input', () => {
    expect(parseLlcTime('nope')).toBeUndefined();
    expect(parseLlcTime('')).toBeUndefined();
    expect(parseLlcTime('01:99:03')).toBeUndefined();
    expect(parseLlcTime(NaN)).toBeUndefined();
    expect(parseLlcTime(Infinity)).toBeUndefined();
  });

  it('round trips the formatted timecode', () => {
    for (const seconds of [0, 1.5, 3723.456789, 3600.000000123]) {
      expect(parseLlcTime(formatLlcTime(seconds))).toBeCloseTo(seconds, 9);
    }
  });
});

describe('normalizeLlcTimeValue', () => {
  it('turns a stored time value back into seconds', () => {
    expect(normalizeLlcTimeValue('00:00:01.500000000')).toBe(1.5);
    expect(normalizeLlcTimeValue(1.5)).toBe(1.5);
  });

  it('returns undefined for missing or unparsable values', () => {
    expect(normalizeLlcTimeValue(undefined)).toBeUndefined();
    expect(normalizeLlcTimeValue('nope')).toBeUndefined();
  });
});

describe('getLlcProjectVersion', () => {
  it('binds the numeric format to v2 so upstream can still open the file', () => {
    expect(getLlcProjectVersion('seconds')).toBe(2);
  });

  it('writes the readable format as v3', () => {
    expect(getLlcProjectVersion('timecode')).toBe(3);
  });
});
