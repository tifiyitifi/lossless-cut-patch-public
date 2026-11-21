// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { summarizePatchDeleteOutcomes } from './deleteOutcome.js';
import type { PatchDeleteOutcome } from './deleteOutcome.js';

describe('summarizePatchDeleteOutcomes', () => {
  it('counts the deleted files and everything else as failed', () => {
    const outcomes: PatchDeleteOutcome[] = [
      { path: 'a.mp4', status: 'deleted' },
      { path: 'b.mp4', status: 'locked' },
      { path: 'c.mp4', status: 'deleted' },
      { path: 'd.mp4', status: 'not-deletable' },
    ];

    expect(summarizePatchDeleteOutcomes(outcomes)).toStrictEqual({ deleted: 2, failed: 2 });
  });

  it('reports an empty run as nothing deleted', () => {
    expect(summarizePatchDeleteOutcomes([])).toStrictEqual({ deleted: 0, failed: 0 });
  });

  it('does not count a file that was already gone as deleted', () => {
    expect(summarizePatchDeleteOutcomes([{ path: 'a.mp4', status: 'missing' }])).toStrictEqual({ deleted: 0, failed: 1 });
  });
});
