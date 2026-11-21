// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { availablePatchPlayerViews, buildClipPlaylist, stepPatchPlayerView } from './playlist.js';

describe('availablePatchPlayerViews', () => {
  it('is empty without a file or clips', () => {
    expect(availablePatchPlayerViews({ filePath: undefined, exportedPaths: [] })).toStrictEqual([]);
  });

  it('offers source once a file is open', () => {
    expect(availablePatchPlayerViews({ filePath: 'a.mp4', exportedPaths: [] })).toStrictEqual(['source']);
  });

  it('offers cut and merge once clips exist', () => {
    expect(availablePatchPlayerViews({ filePath: 'a.mp4', exportedPaths: ['c1.mp4'] })).toStrictEqual(['source', 'cut', 'merge']);
  });
});

describe('buildClipPlaylist', () => {
  it('numbers the entries from one', () => {
    expect(buildClipPlaylist(['a.mp4', 'b.mp4'])).toStrictEqual([
      { path: 'a.mp4', index: 1 },
      { path: 'b.mp4', index: 2 },
    ]);
  });

  it('is empty for no clips', () => {
    expect(buildClipPlaylist([])).toStrictEqual([]);
  });
});

describe('stepPatchPlayerView', () => {
  const views = ['source', 'cut', 'merge'] as const;

  it('wraps forward', () => {
    expect(stepPatchPlayerView(views, 'source', 1)).toBe('cut');
    expect(stepPatchPlayerView(views, 'merge', 1)).toBe('source');
  });

  it('wraps backward', () => {
    expect(stepPatchPlayerView(views, 'source', -1)).toBe('merge');
  });

  it('starts from the first candidate when the current view is unavailable', () => {
    expect(stepPatchPlayerView(['source'], 'cut', 1)).toBe('source');
  });

  it('returns the current view when nothing is available', () => {
    expect(stepPatchPlayerView([], 'source', 1)).toBe('source');
  });
});
