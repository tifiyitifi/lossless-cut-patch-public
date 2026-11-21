// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { formatLegacyTime, parseLegacyTime } from './timeParse.js';

describe('parseLegacyTime', () => {
  it('parses 6-9 digit HHMMSSfff tokens (right padded)', () => {
    expect(parseLegacyTime('010203')).toBe(3723);
    expect(parseLegacyTime('010203456')).toBe(3723.456);
    expect(parseLegacyTime('0102034')).toBe(3723.4);
  });

  it('parses colon separated times', () => {
    expect(parseLegacyTime('01:02:03')).toBe(3723);
    expect(parseLegacyTime('01:02:03.5')).toBe(3723.5);
    expect(parseLegacyTime('01:02:03.456')).toBe(3723.456);
  });

  it('accepts fullwidth colons', () => {
    expect(parseLegacyTime('01：02：03')).toBe(3723);
  });

  it('returns undefined for invalid input', () => {
    expect(parseLegacyTime('nope')).toBeUndefined();
    expect(parseLegacyTime('12345')).toBeUndefined();
    expect(parseLegacyTime('')).toBeUndefined();
  });
});

describe('formatLegacyTime', () => {
  it('formats seconds as HH:MM:SS.fff', () => {
    expect(formatLegacyTime(3723)).toBe('01:02:03.000');
    expect(formatLegacyTime(3723.456)).toBe('01:02:03.456');
    expect(formatLegacyTime(0)).toBe('00:00:00.000');
  });

  it('round trips through parseLegacyTime', () => {
    expect(parseLegacyTime(formatLegacyTime(3723.456))).toBe(3723.456);
  });
});
