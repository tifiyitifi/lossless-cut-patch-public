// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getConcatProbeIntervals } from './concatWindow.js';

describe('getConcatProbeIntervals', () => {
  it('reads the first second and the tail of a normal clip', () => {
    expect(getConcatProbeIntervals(60)).toBe('0%1,58%61');
  });

  it('reads the whole file when it is too short for two windows', () => {
    expect(getConcatProbeIntervals(2)).toBe('0%3');
    expect(getConcatProbeIntervals(0.5)).toBe('0%3');
  });

  it('gives up instead of reading only the first seconds of an unknown-duration file', () => {
    // `0` and `NaN` come from ffprobe's `duration` field: a tail window cannot be computed, and
    // reading `0%3` would report the third second as the end of the file.
    expect(getConcatProbeIntervals(0)).toBeUndefined();
    expect(getConcatProbeIntervals(NaN)).toBeUndefined();
    expect(getConcatProbeIntervals(-2)).toBeUndefined();
    expect(getConcatProbeIntervals(undefined)).toBeUndefined();
  });
});
