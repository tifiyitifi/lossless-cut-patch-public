// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { isMergedRebuildableFromClips } from './mergedRebuild.js';

describe('isMergedRebuildableFromClips', () => {
  it('is rebuildable when every segment the merge was built from is still a cut result', () => {
    expect(isMergedRebuildableFromClips({
      mergedSegIds: ['a', 'b'],
      clips: [{ segId: 'b' }, { segId: 'a' }, { segId: 'c' }],
    })).toBe(true);
  });

  it('is not rebuildable when a segment the merge was built from is gone', () => {
    expect(isMergedRebuildableFromClips({
      mergedSegIds: ['a', 'b'],
      clips: [{ segId: 'c' }],
    })).toBe(false);
    expect(isMergedRebuildableFromClips({
      mergedSegIds: ['a', 'b'],
      clips: [{ segId: 'a' }],
    })).toBe(false);
  });

  it('claims nothing about a merge whose segments were not recorded', () => {
    expect(isMergedRebuildableFromClips({ mergedSegIds: undefined, clips: [] })).toBe(true);
    expect(isMergedRebuildableFromClips({ mergedSegIds: [], clips: [] })).toBe(true);
  });

  it('ignores cut results without a segment identity', () => {
    expect(isMergedRebuildableFromClips({ mergedSegIds: ['a'], clips: [{}, { segId: 'a' }] })).toBe(true);
  });
});
