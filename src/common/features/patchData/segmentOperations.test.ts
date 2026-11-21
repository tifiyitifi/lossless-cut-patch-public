// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { isPatchSegmentOperation, patchSegmentOperations } from './segmentOperations.js';

describe('patchSegmentOperations', () => {
  it('lists each operation once', () => {
    expect(new Set(patchSegmentOperations).size).toBe(patchSegmentOperations.length);
    expect(patchSegmentOperations.length).toBeGreaterThan(5);
  });
});

describe('isPatchSegmentOperation', () => {
  it('accepts every listed operation', () => {
    for (const operation of patchSegmentOperations) expect(isPatchSegmentOperation(operation)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isPatchSegmentOperation('merge')).toBe(false);
    expect(isPatchSegmentOperation('')).toBe(false);
  });
});
