// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { getNameStem, matchTimePairsTarget } from './matchTarget.js';

const candidates = ['C:/work/inbox/a.mp4', 'C:/work/inbox/b.mp4', 'C:/work/inbox/b [2160p].mkv'];

describe('getNameStem', () => {
  it('drops the extension and the bracketed tags', () => {
    expect(getNameStem('a.mp4')).toBe('a');
    expect(getNameStem('a [1080p].mp4')).toBe('a');
    expect(getNameStem('[Group] a [1080p].mp4')).toBe('a');
    expect(getNameStem('我的视频 第1集.mp4')).toBe('我的视频 第1集');
  });

  it('keeps parentheses, because they name a different file', () => {
    expect(getNameStem('a (1).mp4')).toBe('a (1)');
  });

  it('collapses spacing', () => {
    expect(getNameStem('  a   [1080p]   .mp4 ')).toBe('a');
  });
});

describe('matchTimePairsTarget', () => {
  it('prefers the exact file name', () => {
    // `b.mp4` is an exact hit even though `b` has a second candidate below.
    expect(matchTimePairsTarget({ wantedName: 'b.mp4', filePaths: candidates, caseInsensitive: true }))
      .toStrictEqual({ kind: 'exact', path: 'C:/work/inbox/b.mp4' });
  });

  it('matches a tag-carrying name to the local copy by stem', () => {
    expect(matchTimePairsTarget({ wantedName: 'a [1080p].mp4', filePaths: candidates, caseInsensitive: true }))
      .toStrictEqual({ kind: 'stem', path: 'C:/work/inbox/a.mp4' });
  });

  it('ignores the extension on both sides', () => {
    expect(matchTimePairsTarget({ wantedName: 'a.mkv', filePaths: candidates, caseInsensitive: true }))
      .toStrictEqual({ kind: 'stem', path: 'C:/work/inbox/a.mp4' });
    expect(matchTimePairsTarget({ wantedName: 'b.mp4', filePaths: candidates, caseInsensitive: true }))
      .toStrictEqual({ kind: 'exact', path: 'C:/work/inbox/b.mp4' });
  });

  it('does not guess between two videos with the same stem', () => {
    expect(matchTimePairsTarget({ wantedName: 'b [1080p].mp4', filePaths: candidates, caseInsensitive: true }))
      .toStrictEqual({ kind: 'ambiguous', paths: ['C:/work/inbox/b.mp4', 'C:/work/inbox/b [2160p].mkv'] });
  });

  it('reads the name through the brackets of the candidate too', () => {
    expect(matchTimePairsTarget({ wantedName: 'b.mkv', filePaths: candidates, caseInsensitive: true }))
      .toStrictEqual({ kind: 'ambiguous', paths: ['C:/work/inbox/b.mp4', 'C:/work/inbox/b [2160p].mkv'] });
  });

  it('follows the case rule of the file system', () => {
    expect(matchTimePairsTarget({ wantedName: 'A.MP4', filePaths: candidates, caseInsensitive: true }))
      .toStrictEqual({ kind: 'exact', path: 'C:/work/inbox/a.mp4' });
    // A case-sensitive file system has no `A.MP4` here, and the stem differs by case too.
    expect(matchTimePairsTarget({ wantedName: 'A.MP4', filePaths: candidates, caseInsensitive: false }))
      .toStrictEqual({ kind: 'none' });
  });

  it('is none without a name or without a match', () => {
    expect(matchTimePairsTarget({ wantedName: undefined, filePaths: candidates, caseInsensitive: true })).toStrictEqual({ kind: 'none' });
    expect(matchTimePairsTarget({ wantedName: '  ', filePaths: candidates, caseInsensitive: true })).toStrictEqual({ kind: 'none' });
    expect(matchTimePairsTarget({ wantedName: 'z.mp4', filePaths: candidates, caseInsensitive: true })).toStrictEqual({ kind: 'none' });
  });

  it('ignores missing and repeated entries', () => {
    expect(matchTimePairsTarget({ wantedName: 'a.mp4', filePaths: [undefined, 'C:/a.mp4', 'C:/a.mp4', ''], caseInsensitive: true }))
      .toStrictEqual({ kind: 'exact', path: 'C:/a.mp4' });
  });

  it('takes a name without a folder part', () => {
    expect(matchTimePairsTarget({ wantedName: 'C:/other/a.mp4', filePaths: candidates, caseInsensitive: true }))
      .toStrictEqual({ kind: 'exact', path: 'C:/work/inbox/a.mp4' });
  });
});
