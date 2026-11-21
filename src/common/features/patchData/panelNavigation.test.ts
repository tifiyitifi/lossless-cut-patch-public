// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getAdjacentPanel } from './panelNavigation.js';

describe('getAdjacentPanel', () => {
  it('moves between the columns', () => {
    expect(getAdjacentPanel('player', 'right')).toBe('segments');
    expect(getAdjacentPanel('player', 'left')).toBe('videoList');
    expect(getAdjacentPanel('segments', 'left')).toBe('player');
    expect(getAdjacentPanel('videoList', 'right')).toBe('player');
  });

  it('walks the bottom band horizontally', () => {
    expect(getAdjacentPanel('keyGuide', 'right')).toBe('console');
    expect(getAdjacentPanel('console', 'left')).toBe('keyGuide');
    expect(getAdjacentPanel('console', 'right')).toBe('mergePreview');
    expect(getAdjacentPanel('mergePreview', 'left')).toBe('console');
  });

  it('moves within a column', () => {
    expect(getAdjacentPanel('workDir', 'down')).toBe('videoList');
    expect(getAdjacentPanel('videoList', 'up')).toBe('workDir');
    expect(getAdjacentPanel('videoList', 'down')).toBe('keyGuide');
    expect(getAdjacentPanel('keyGuide', 'up')).toBe('videoList');
    expect(getAdjacentPanel('player', 'down')).toBe('console');
    expect(getAdjacentPanel('console', 'up')).toBe('player');
    expect(getAdjacentPanel('segments', 'down')).toBe('mergePreview');
    expect(getAdjacentPanel('mergePreview', 'up')).toBe('segments');
  });

  it('is a no-op at the edges', () => {
    expect(getAdjacentPanel('workDir', 'up')).toBeUndefined();
    expect(getAdjacentPanel('workDir', 'left')).toBeUndefined();
    expect(getAdjacentPanel('player', 'up')).toBeUndefined();
    expect(getAdjacentPanel('mergePreview', 'down')).toBeUndefined();
    expect(getAdjacentPanel('mergePreview', 'right')).toBeUndefined();
    expect(getAdjacentPanel('segments', 'up')).toBeUndefined();
    expect(getAdjacentPanel('console', 'down')).toBeUndefined();
  });
});
