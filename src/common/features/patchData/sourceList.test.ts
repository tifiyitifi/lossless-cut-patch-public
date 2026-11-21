// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { clampSourceListWidth, defaultSourceListWidth, formatCompactModifiedTime, formatFileSize, maxSourceListWidth, minSourceListWidth } from './sourceList.js';

describe('clampSourceListWidth', () => {
  it('keeps a width inside the usable range', () => {
    expect(clampSourceListWidth(360)).toBe(360);
    expect(clampSourceListWidth(minSourceListWidth)).toBe(minSourceListWidth);
    expect(clampSourceListWidth(maxSourceListWidth)).toBe(maxSourceListWidth);
  });

  it('pulls a hand-edited value back into the range', () => {
    expect(clampSourceListWidth(10)).toBe(minSourceListWidth);
    expect(clampSourceListWidth(0)).toBe(minSourceListWidth);
    expect(clampSourceListWidth(5000)).toBe(maxSourceListWidth);
  });

  it('falls back to the default for a missing or broken value', () => {
    expect(clampSourceListWidth(undefined)).toBe(defaultSourceListWidth);
    expect(clampSourceListWidth(NaN)).toBe(defaultSourceListWidth);
    expect(clampSourceListWidth(Infinity)).toBe(defaultSourceListWidth);
  });

  it('rounds a fractional drag position', () => {
    expect(clampSourceListWidth(320.6)).toBe(321);
  });
});

describe('formatFileSize', () => {
  it('uses no fraction for bytes and for three-digit values', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(999)).toBe('999 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(128 * 1024 * 1024)).toBe('128 MB');
  });

  it('steps through KB, MB and GB', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1.25 * 1024 * 1024)).toBe('1.3 MB');
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
    expect(formatFileSize(3 * 1024 ** 4)).toBe('3.0 TB');
  });

  it('stops at TB instead of inventing a unit', () => {
    expect(formatFileSize(2048 * 1024 ** 4)).toBe('2048 TB');
  });

  it('reports nothing for a value a row does not have', () => {
    expect(formatFileSize(undefined)).toBeUndefined();
    expect(formatFileSize(NaN)).toBeUndefined();
    expect(formatFileSize(-1)).toBeUndefined();
  });
});

describe('formatCompactModifiedTime', () => {
  // Built from local parts, so the expectation does not depend on the machine's time zone.
  const localMs = new Date(2026, 10, 5, 9, 7, 0).getTime();

  it('prints a compact local timestamp with zero padding', () => {
    expect(formatCompactModifiedTime(localMs)).toBe('2026-11-05 09:07');
  });

  it('leaves out the seconds', () => {
    expect(formatCompactModifiedTime(localMs + 45_000)).toBe('2026-11-05 09:07');
  });

  it('reports nothing for a value a row does not have', () => {
    expect(formatCompactModifiedTime(undefined)).toBeUndefined();
    expect(formatCompactModifiedTime(0)).toBeUndefined();
    expect(formatCompactModifiedTime(NaN)).toBeUndefined();
  });
});
