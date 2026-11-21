// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { moveOverviewSelection } from './overviewRows.js';

describe('moveOverviewSelection', () => {
  it('skips rows that lead nowhere', () => {
    const selectable = [false, false, true, false, true];
    expect(moveOverviewSelection(selectable, 2, 1)).toBe(4);
    expect(moveOverviewSelection(selectable, 4, -1)).toBe(2);
  });

  it('starts at the nearest selectable row when the current one is a header', () => {
    expect(moveOverviewSelection([false, true, false], 0, 1)).toBe(1);
  });

  it('stays on the first and last selectable row', () => {
    expect(moveOverviewSelection([true, false, true], 2, 1)).toBe(2);
    expect(moveOverviewSelection([true, false, true], 0, -1)).toBe(0);
  });

  it('reports nothing to select', () => {
    expect(moveOverviewSelection([false, false], 0, 1)).toBe(-1);
    expect(moveOverviewSelection([], 0, 1)).toBe(-1);
  });
});
