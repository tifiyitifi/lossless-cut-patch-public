// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { resolvePatchDrop } from './droppedPaths.js';

describe('resolvePatchDrop', () => {
  it('is none for nothing', () => {
    expect(resolvePatchDrop([])).toStrictEqual({ kind: 'none' });
  });

  it('prefers a dropped folder (it becomes the work directory)', () => {
    expect(resolvePatchDrop([
      { path: String.raw`C:\videos\a.mp4`, isDirectory: false },
      { path: String.raw`D:\inbox`, isDirectory: true },
    ])).toStrictEqual({ kind: 'open-directory', path: String.raw`D:\inbox` });
  });

  it('opens the first media file', () => {
    expect(resolvePatchDrop([
      { path: '/tmp/notes.txt', isDirectory: false },
      { path: '/tmp/b.mkv', isDirectory: false },
    ])).toStrictEqual({ kind: 'open-file', path: '/tmp/b.mkv' });
  });

  it('ignores non-media files', () => {
    expect(resolvePatchDrop([
      { path: '/tmp/notes.txt', isDirectory: false },
      { path: '/tmp/logo.png', isDirectory: false },
    ])).toStrictEqual({ kind: 'none' });
  });

  it('finds the media file among mixed windows paths', () => {
    expect(resolvePatchDrop([
      { path: String.raw`C:\a\README.md`, isDirectory: false },
      { path: String.raw`C:\a\clip.MP4`, isDirectory: false },
    ])).toStrictEqual({ kind: 'open-file', path: String.raw`C:\a\clip.MP4` });
  });
});
