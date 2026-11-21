// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import compareStrings from './stringOrder.js';

describe('compareStrings', () => {
  it('orders by code point instead of the machine collation', () => {
    // `localeCompare('en-US')` puts `a` before `B`; code points put uppercase first.
    expect(['b', 'a', 'B'].sort(compareStrings)).toStrictEqual(['B', 'a', 'b']);
    expect(compareStrings('a', 'a')).toBe(0);
  });

  it('keeps different strings apart even when they collate as equal', () => {
    // `e` and the combining acute accent are different code points, so one always comes first.
    expect(compareStrings('e', 'e\u{301}')).not.toBe(0);
  });
});
