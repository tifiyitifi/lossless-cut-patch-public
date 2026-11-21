// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { parseCompactTimeInput } from './parseCompactTime.js';

describe('parseCompactTimeInput', () => {
  it('reads digits without separators as positional HHMMSSfff', () => {
    expect(parseCompactTimeInput('..5')).toBe(5);
    expect(parseCompactTimeInput('..123')).toBe(83);
    expect(parseCompactTimeInput('..3456')).toBe(2096);
    expect(parseCompactTimeInput('..12345')).toBe(5025);
    expect(parseCompactTimeInput('..010203')).toBe(3723);
    expect(parseCompactTimeInput('..123456')).toBe(45296);
  });

  it('pads 6 to 8 digits at the back, as milliseconds', () => {
    expect(parseCompactTimeInput('..1234567')).toBeCloseTo(45296.7, 6);
    expect(parseCompactTimeInput('..12345678')).toBeCloseTo(45296.78, 6);
    expect(parseCompactTimeInput('..123456789')).toBeCloseTo(45296.789, 6);
  });

  it('reads the values between dots on the ladder counted from the right', () => {
    expect(parseCompactTimeInput('..1.2.3')).toBe(3723);
    expect(parseCompactTimeInput('..0102.3')).toBe(3723);
    expect(parseCompactTimeInput('..12.34.56')).toBe(45296);
  });

  it('takes a fourth value as milliseconds, padded at the back', () => {
    expect(parseCompactTimeInput('..12.34.56.7')).toBeCloseTo(45296.7, 6);
    expect(parseCompactTimeInput('..12.34.56.789')).toBeCloseTo(45296.789, 6);
  });

  it('does not give the separators a meaning of their own', () => {
    expect(parseCompactTimeInput('..123456.7')).toBeCloseTo(parseCompactTimeInput('..1234567')!, 6);
    expect(parseCompactTimeInput('..12:34:56')).toBe(parseCompactTimeInput('..12.34.56'));
  });

  it('ignores whitespace', () => {
    expect(parseCompactTimeInput('  .. 1.2.3  ')).toBe(3723);
  });

  it('ignores a trailing separator, so a half-typed fraction keeps its value', () => {
    expect(parseCompactTimeInput('..012228.')).toBe(4948);
    expect(parseCompactTimeInput('..012228:')).toBe(4948);
    expect(parseCompactTimeInput('..1234567.')).toBeCloseTo(45296.7, 6);
    expect(parseCompactTimeInput('..1.2.3.')).toBe(3723);
    expect(parseCompactTimeInput('..1.')).toBe(1);
  });

  it('returns undefined when the input is not a compact time', () => {
    expect(parseCompactTimeInput('..')).toBeUndefined();
    expect(parseCompactTimeInput('..1234567890')).toBeUndefined();
    expect(parseCompactTimeInput('..1..2')).toBeUndefined();
    expect(parseCompactTimeInput('..1.2.3.4.5')).toBeUndefined();
    expect(parseCompactTimeInput('..1.70.3')).toBeUndefined();
    expect(parseCompactTimeInput('..999999')).toBeUndefined();
    expect(parseCompactTimeInput('..abc')).toBeUndefined();
    expect(parseCompactTimeInput('...1234')).toBeUndefined();
    expect(parseCompactTimeInput('..1..')).toBeUndefined();
    expect(parseCompactTimeInput('..1..2')).toBeUndefined();
    expect(parseCompactTimeInput('..1.2..3')).toBeUndefined();
  });

  it('leaves the numbers of the upstream parser alone', () => {
    expect(parseCompactTimeInput('123456')).toBeUndefined();
    expect(parseCompactTimeInput('00.5')).toBeUndefined();
    expect(parseCompactTimeInput('00:12:34')).toBeUndefined();
    expect(parseCompactTimeInput('+..1234')).toBeUndefined();
  });
});
