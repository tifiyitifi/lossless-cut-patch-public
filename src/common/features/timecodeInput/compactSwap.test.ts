// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { applyCompactSwap } from './compactSwap.js';
import { parseCompactTimeInput } from './parseCompactTime.js';

describe('applyCompactSwap', () => {
  it('leaves the value alone when the swap is off', () => {
    expect(applyCompactSwap('1234', false)).toBe('1234');
    expect(applyCompactSwap('..1234', false)).toBe('..1234');
    expect(applyCompactSwap('+..1234', false)).toBe('+..1234');
  });

  it('turns a plain value into the compact form with the swap on', () => {
    expect(applyCompactSwap('1234', true)).toBe('..1234');
    expect(applyCompactSwap('01:22:28', true)).toBe('..01:22:28');
  });

  it('turns a compact value into the plain form with the swap on', () => {
    expect(applyCompactSwap('..1234', true)).toBe('1234');
    expect(applyCompactSwap('..', true)).toBe('');
  });

  it('keeps the relative sign in front of the marker', () => {
    expect(applyCompactSwap('+1234', true)).toBe('+..1234');
    expect(applyCompactSwap('-1234', true)).toBe('-..1234');
    expect(applyCompactSwap('+..1234', true)).toBe('+1234');
    expect(applyCompactSwap('-..1234', true)).toBe('-1234');
  });

  it('swaps the meaning, not the time, so the same text keeps its value', () => {
    for (const text of ['..012228', '..1.2.3', '..12.34.56.7']) {
      const swapped = applyCompactSwap(text, true);
      expect(parseCompactTimeInput(text)).toBeDefined();
      // After the swap the text is the plain form: the compact parser must no longer take it.
      expect(parseCompactTimeInput(swapped)).toBeUndefined();
      // ...and swapping it back restores the compact value.
      expect(applyCompactSwap(swapped, true)).toBe(text);
    }
  });
});
