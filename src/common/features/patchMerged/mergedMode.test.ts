// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { disablePatchMergedActions, patchMergedDisabledActions } from './mergedMode.js';

describe('patchMergedDisabledActions', () => {
  it('covers deleting and relabelling the displayed chapters', () => {
    expect(patchMergedDisabledActions).toContain('removeSelectedSegments');
    expect(patchMergedDisabledActions).toContain('labelCurrentSegment');
    expect(patchMergedDisabledActions).not.toContain('jumpSegmentEndPreview');
    expect(patchMergedDisabledActions).not.toContain('playlistPrev');
  });

  it('replaces only the listed actions', () => {
    const actions = {
      removeSelectedSegments: () => 'removed',
      jumpSegmentEndPreview: () => 'preview',
    };
    expect(disablePatchMergedActions(actions).removeSelectedSegments()).toBeUndefined();
    expect(disablePatchMergedActions(actions).jumpSegmentEndPreview()).toBe('preview');
  });
});
