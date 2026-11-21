// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { shouldAutoPlayAfterOpen } from './autoPlay.js';

const windowsPath = String.raw`C:\videos\a.mp4`;

describe('shouldAutoPlayAfterOpen', () => {
  it('plays the file the key asked for', () => {
    expect(shouldAutoPlayAfterOpen({
      requestedPath: windowsPath,
      loadedPath: windowsPath,
      caseInsensitive: true,
    })).toBe(true);
  });

  it('stays paused when another file finished loading', () => {
    // A refused or failed open keeps the old file open: the request belongs to the file that never
    // arrived, so it must not start playing whatever happens to be loaded.
    expect(shouldAutoPlayAfterOpen({
      requestedPath: String.raw`C:\videos\b.mp4`,
      loadedPath: windowsPath,
      caseInsensitive: true,
    })).toBe(false);
  });

  it('stays paused when nothing was requested or nothing loaded', () => {
    expect(shouldAutoPlayAfterOpen({ requestedPath: undefined, loadedPath: windowsPath, caseInsensitive: true })).toBe(false);
    expect(shouldAutoPlayAfterOpen({ requestedPath: windowsPath, loadedPath: undefined, caseInsensitive: true })).toBe(false);
  });

  it('compares the paths the way the file system does', () => {
    // One file can arrive with another spelling (separators, case).
    expect(shouldAutoPlayAfterOpen({
      requestedPath: 'C:/videos/A.mp4',
      loadedPath: windowsPath,
      caseInsensitive: true,
    })).toBe(true);
    expect(shouldAutoPlayAfterOpen({
      requestedPath: 'C:/videos/A.mp4',
      loadedPath: windowsPath,
      caseInsensitive: false,
    })).toBe(false);
  });
});
