// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { filterPatchMediaPaths, isPatchMediaPath } from './mediaPaths.js';

describe('isPatchMediaPath', () => {
  it('accepts supported video and audio extensions', () => {
    expect(isPatchMediaPath('/tmp/clip.mp4')).toBe(true);
    expect(isPatchMediaPath(String.raw`C:\videos\clip.MKV`)).toBe(true);
    expect(isPatchMediaPath('/tmp/song.flac')).toBe(true);
    // Containers FFmpeg reads that are easy to miss in a hand-written list.
    for (const extension of ['mka', 'weba', 'oga', 'aif', 'aiff']) {
      expect(isPatchMediaPath(`/tmp/media.${extension}`)).toBe(true);
    }
  });

  it('rejects files that cannot be played', () => {
    expect(isPatchMediaPath('/tmp/notes.txt')).toBe(false);
    expect(isPatchMediaPath('/tmp/logo.png')).toBe(false);
    expect(isPatchMediaPath('/tmp/project.llc')).toBe(false);
    expect(isPatchMediaPath('/tmp/subtitles.srt')).toBe(false);
    expect(isPatchMediaPath('/tmp/chapters.csv')).toBe(false);
    expect(isPatchMediaPath('/tmp/README')).toBe(false);
  });

  it('looks at the file name, not at dots in a directory name', () => {
    expect(isPatchMediaPath(String.raw`C:\my.clips\README`)).toBe(false);
    expect(isPatchMediaPath(String.raw`C:\my.clips\clip.mp4`)).toBe(true);
  });
});

describe('filterPatchMediaPaths', () => {
  it('keeps media in order and reports what was skipped', () => {
    expect(filterPatchMediaPaths([
      String.raw`C:\a\clips\one.txt`,
      String.raw`C:\a\videos\first.mp4`,
      String.raw`C:\a\videos\second.M2TS`,
      String.raw`C:\a\videos\cover.jpg`,
    ])).toStrictEqual({
      media: [String.raw`C:\a\videos\first.mp4`, String.raw`C:\a\videos\second.M2TS`],
      skipped: [String.raw`C:\a\clips\one.txt`, String.raw`C:\a\videos\cover.jpg`],
    });
  });

  it('is empty for an empty list', () => {
    expect(filterPatchMediaPaths([])).toStrictEqual({ media: [], skipped: [] });
  });

  it('skips everything when nothing can be played', () => {
    expect(filterPatchMediaPaths(['/tmp/a.llc', '/tmp/a.srt'])).toStrictEqual({
      media: [],
      skipped: ['/tmp/a.llc', '/tmp/a.srt'],
    });
  });

  it('does not mutate the input', () => {
    const paths = ['/tmp/a.txt', '/tmp/a.mp4'];
    filterPatchMediaPaths(paths);
    expect(paths).toStrictEqual(['/tmp/a.txt', '/tmp/a.mp4']);
  });
});
